import type { NetXrayIR, Node, Link, AclRule } from "../types/netxray-ir";
import type {
  SimEngine,
  PacketHeader,
  PacketPath,
  PathHop,
  RoutingUpdate,
  ShadowedRule,
  FailureSpec,
  ConvergenceStep,
} from "./types";

interface Graph {
  adjacency: Map<string, { neighbor: string; link: Link; cost: number }[]>;
  nodes: Map<string, Node>;
}

function buildGraph(ir: NetXrayIR): Graph {
  const adjacency = new Map<string, { neighbor: string; link: Link; cost: number }[]>();
  const nodes = new Map<string, Node>();

  for (const node of ir.topology.nodes) {
    nodes.set(node.id, node);
    adjacency.set(node.id, []);
  }

  for (const link of ir.topology.links) {
    if (link.state === "down") continue;
    const srcNode = nodes.get(link.source.node);
    const tgtNode = nodes.get(link.target.node);
    if (!srcNode || !tgtNode) continue;

    const srcCost = srcNode.interfaces?.[link.source.interface]?.cost ?? 10;
    const tgtCost = tgtNode.interfaces?.[link.target.interface]?.cost ?? 10;

    adjacency.get(link.source.node)!.push({
      neighbor: link.target.node,
      link,
      cost: srcCost,
    });
    adjacency.get(link.target.node)!.push({
      neighbor: link.source.node,
      link,
      cost: tgtCost,
    });
  }

  return { adjacency, nodes };
}

function evaluateAcl(aclRules: AclRule[], packet: PacketHeader): { rule: AclRule | null; action: "permit" | "deny" | "no-match" } {
  for (const rule of aclRules) {
    if (rule.protocol !== "any" && rule.protocol !== packet.protocol) continue;
    if (rule.dst_port !== null && rule.dst_port !== undefined && rule.dst_port !== packet.dst_port) continue;
    if (rule.src_port !== null && rule.src_port !== undefined && rule.src_port !== packet.src_port) continue;
    if (rule.src !== "any" && !ipMatchesCidr(packet.src_ip, rule.src)) continue;
    if (rule.dst !== "any" && !ipMatchesCidr(packet.dst_ip, rule.dst)) continue;
    return { rule, action: rule.action };
  }
  return { rule: null, action: "no-match" };
}

function ipMatchesCidr(ip: string, cidr: string): boolean {
  if (cidr === "any") return true;
  const [network, prefixStr] = cidr.split("/");
  if (!prefixStr) return ip === network;

  const prefix = parseInt(prefixStr, 10);
  const ipNum = ipToNum(ip);
  const netNum = ipToNum(network);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;

  return (ipNum & mask) === (netNum & mask);
}

function ipToNum(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function ruleIsShadowedBy(candidate: AclRule, earlier: AclRule): boolean {
  if (earlier.protocol !== "any" && earlier.protocol !== candidate.protocol) return false;
  if (!cidrContains(earlier.src, candidate.src)) return false;
  if (!cidrContains(earlier.dst, candidate.dst)) return false;
  if (earlier.dst_port !== null && earlier.dst_port !== undefined) {
    if (candidate.dst_port !== null && candidate.dst_port !== undefined) {
      if (earlier.dst_port !== candidate.dst_port) return false;
    } else {
      return false;
    }
  }
  if (earlier.src_port !== null && earlier.src_port !== undefined) {
    if (candidate.src_port !== null && candidate.src_port !== undefined) {
      if (earlier.src_port !== candidate.src_port) return false;
    } else {
      return false;
    }
  }
  return true;
}

function cidrContains(outer: string, inner: string): boolean {
  if (outer === "any") return true;
  if (inner === "any") return false;
  if (outer === inner) return true;

  const [outerNet, outerPrefixStr] = outer.split("/");
  const [innerNet, innerPrefixStr] = inner.split("/");
  const outerPrefix = parseInt(outerPrefixStr ?? "32", 10);
  const innerPrefix = parseInt(innerPrefixStr ?? "32", 10);

  if (outerPrefix > innerPrefix) return false;

  const mask = outerPrefix === 0 ? 0 : (~0 << (32 - outerPrefix)) >>> 0;
  return (ipToNum(outerNet) & mask) === (ipToNum(innerNet) & mask);
}

function buildShadowReason(earlier: AclRule, later: AclRule): string {
  if (earlier.action === later.action) {
    return `Both rules ${earlier.action} — seq ${later.seq} is redundant`;
  }
  return `Seq ${later.seq} (${later.action}) is unreachable due to seq ${earlier.seq} (${earlier.action})`;
}

/** Encapsulated mock engine — no module-level mutable state */
class MockEngine implements SimEngine {
  private currentIR: NetXrayIR | null = null;
  private graph: Graph | null = null;

  loadTopology(ir: NetXrayIR): void {
    this.currentIR = ir;
    this.graph = buildGraph(ir);
  }

  simulatePacket(packet: PacketHeader): PacketPath {
    if (!this.currentIR || !this.graph) {
      return { hops: [], result: "unreachable", drop_reason: "No topology loaded" };
    }

    const srcNode = this.findNodeByIp(packet.src_ip);
    const dstNode = this.findNodeByIp(packet.dst_ip);

    if (!srcNode) return { hops: [], result: "unreachable", drop_reason: `Source IP ${packet.src_ip} not found` };
    if (!dstNode) return { hops: [], result: "unreachable", drop_reason: `Destination IP ${packet.dst_ip} not found` };

    const path = this.dijkstra(srcNode.id, dstNode.id);
    if (!path) return { hops: [], result: "unreachable", drop_reason: "No route to destination" };

    const hops: PathHop[] = [];

    for (let i = 0; i < path.length; i++) {
      const nodeId = path[i];
      const node: Node = this.graph.nodes.get(nodeId)!;
      let ingressIface: string | null = null;
      let egressIface: string | null = null;

      if (i > 0) {
        const prevLink = this.findLinkBetween(path[i - 1], nodeId);
        if (prevLink) {
          ingressIface = prevLink.source.node === nodeId
            ? prevLink.source.interface
            : prevLink.target.interface;
        }
      }

      if (i < path.length - 1) {
        const nextLink = this.findLinkBetween(nodeId, path[i + 1]);
        if (nextLink) {
          egressIface = nextLink.source.node === nodeId
            ? nextLink.source.interface
            : nextLink.target.interface;
        }
      }

      // Evaluate ingress ACL
      if (ingressIface && node.interfaces?.[ingressIface]?.acl_in) {
        const aclName = node.interfaces[ingressIface].acl_in!;
        const aclRules = this.currentIR.policies?.acls?.[aclName];
        if (aclRules) {
          const result = evaluateAcl(aclRules, packet);
          const hop: PathHop = {
            node_id: nodeId,
            ingress_interface: ingressIface,
            egress_interface: egressIface,
            acl_result: {
              acl_name: aclName,
              matched_rule: result.rule,
              action: result.action,
            },
          };
          if (result.action === "deny") {
            hops.push(hop);
            return { hops, result: "dropped", drop_reason: `Denied by ${aclName} seq ${result.rule?.seq}` };
          }
          hops.push(hop);
          continue;
        }
      }

      hops.push({
        node_id: nodeId,
        ingress_interface: ingressIface,
        egress_interface: egressIface,
      });
    }

    return { hops, result: "delivered" };
  }

  simulateLinkFailure(linkId: string): RoutingUpdate {
    if (!this.currentIR || !this.graph) {
      return { affected_nodes: [], updated_paths: {} };
    }

    // Rebuild graph from current IR (which has the toggled link state)
    this.graph = buildGraph(this.currentIR);

    const link = this.currentIR.topology.links.find((l) => l.id === linkId);
    if (!link) return { affected_nodes: [], updated_paths: {} };

    const affected = [link.source.node, link.target.node];
    return { affected_nodes: affected, updated_paths: {} };
  }

  detectAclShadows(aclName: string): ShadowedRule[] {
    if (!this.currentIR) return [];
    const rules = this.currentIR.policies?.acls?.[aclName];
    if (!rules) return [];

    const shadows: ShadowedRule[] = [];

    for (let i = 0; i < rules.length; i++) {
      for (let j = i + 1; j < rules.length; j++) {
        if (ruleIsShadowedBy(rules[j], rules[i])) {
          shadows.push({
            acl_name: aclName,
            shadowed_seq: rules[j].seq,
            shadowed_by_seq: rules[i].seq,
            reason: buildShadowReason(rules[i], rules[j]),
          });
        }
      }
    }

    return shadows;
  }

  private findNodeByIp(ip: string): Node | null {
    if (!this.graph) return null;
    for (const node of this.graph.nodes.values()) {
      if (!node.interfaces) continue;
      for (const iface of Object.values(node.interfaces)) {
        if (iface.ip && iface.ip.split("/")[0] === ip) return node;
      }
    }
    return null;
  }

  private dijkstra(srcId: string, dstId: string): string[] | null {
    if (!this.graph) return null;

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();

    for (const nodeId of this.graph.nodes.keys()) {
      dist.set(nodeId, Infinity);
      prev.set(nodeId, null);
    }
    dist.set(srcId, 0);

    while (true) {
      let minNode: string | null = null;
      let minDist = Infinity;
      for (const [nodeId, d] of dist) {
        if (!visited.has(nodeId) && d < minDist) {
          minDist = d;
          minNode = nodeId;
        }
      }
      if (minNode === null) break;
      visited.add(minNode);

      if (minNode === dstId) break;

      const neighbors = this.graph.adjacency.get(minNode) ?? [];
      for (const { neighbor, cost } of neighbors) {
        if (visited.has(neighbor)) continue;
        const newDist = minDist + cost;
        if (newDist < dist.get(neighbor)!) {
          dist.set(neighbor, newDist);
          prev.set(neighbor, minNode);
        }
      }
    }

    if (dist.get(dstId) === Infinity) return null;

    const path: string[] = [];
    let current: string | null = dstId;
    while (current !== null) {
      path.unshift(current);
      current = prev.get(current) ?? null;
    }
    return path;
  }

  private findLinkBetween(nodeA: string, nodeB: string): Link | null {
    if (!this.currentIR) return null;
    return (
      this.currentIR.topology.links.find(
        (l) =>
          (l.source.node === nodeA && l.target.node === nodeB) ||
          (l.source.node === nodeB && l.target.node === nodeA)
      ) ?? null
    );
  }

  // ── What-If Analysis ─────────────────────────────────────────────────────

  simulateNodeFailure(nodeId: string): RoutingUpdate {
    return this.simulateMultiFailure([{ kind: "node", id: nodeId }]);
  }

  simulateMultiFailure(failures: FailureSpec[]): RoutingUpdate {
    if (!this.currentIR) return { affected_nodes: [], updated_paths: {} };

    const excludedNodes = new Set<string>(
      failures.filter((f) => f.kind === "node").map((f) => f.id),
    );
    const excludedLinks = new Set<string>(
      failures.filter((f) => f.kind === "link").map((f) => f.id),
    );

    // Include both endpoints of each failed link in affected_nodes
    const affectedSet = new Set<string>(excludedNodes);
    for (const link of this.currentIR.topology.links) {
      if (excludedLinks.has(link.id)) {
        affectedSet.add(link.source.node);
        affectedSet.add(link.target.node);
      }
    }

    // Build a modified IR with failures applied
    const modifiedIR = this.applyFailures(this.currentIR, failures);
    const modifiedGraph = buildGraph(modifiedIR);

    // Compute routing-table changes for all remaining nodes
    const updatedPaths: RoutingUpdate["updated_paths"] = {};

    for (const nodeId of this.currentIR.topology.nodes.map((n) => n.id)) {
      if (excludedNodes.has(nodeId)) continue;
      const node = this.currentIR.topology.nodes.find((n) => n.id === nodeId);
      if (!node?.vrfs) continue;

      const changes: { prefix: string; new_next_hop: string | null }[] = [];

      for (const vrf of Object.values(node.vrfs)) {
        for (const route of vrf.routing_table ?? []) {
          if (!route.next_hop) continue;
          // Check if next-hop is still reachable in modified graph
          const path = this.dijkstraWithGraph(modifiedGraph, nodeId, route.next_hop.split("/")[0]);
          if (!path) {
            changes.push({ prefix: route.prefix, new_next_hop: null });
          }
        }
      }

      if (changes.length > 0) {
        updatedPaths[nodeId] = changes;
        affectedSet.add(nodeId);
      }
    }

    return { affected_nodes: [...affectedSet], updated_paths: updatedPaths };
  }

  computeAlternatePaths(
    srcNodeId: string,
    dstNodeId: string,
    failures: FailureSpec[],
  ): PacketPath[] {
    if (!this.currentIR) return [];

    const modifiedIR = this.applyFailures(this.currentIR, failures);
    const modifiedGraph = buildGraph(modifiedIR);

    // Use modified graph for path finding
    const path = this.dijkstraWithGraph(modifiedGraph, srcNodeId, dstNodeId);
    if (!path) {
      return [{ hops: [], result: "unreachable", drop_reason: "No route after failures" }];
    }

    const hops: PathHop[] = path.map((nodeId, i) => ({
      node_id: nodeId,
      ingress_interface: i > 0 ? this.findLinkBetween(path[i - 1], nodeId)?.target.interface ?? null : null,
      egress_interface: i < path.length - 1 ? this.findLinkBetween(nodeId, path[i + 1])?.source.interface ?? null : null,
    }));

    return [{ hops, result: "delivered" }];
  }

  simulateConvergence(failures: FailureSpec[]): ConvergenceStep[] {
    if (!this.currentIR) return [];

    const excludedNodes = new Set<string>(
      failures.filter((f) => f.kind === "node").map((f) => f.id),
    );
    const excludedLinks = new Set<string>(
      failures.filter((f) => f.kind === "link").map((f) => f.id),
    );

    const allNodes = this.currentIR.topology.nodes
      .map((n) => n.id)
      .filter((id) => !excludedNodes.has(id));

    const modifiedIR = this.applyFailures(this.currentIR, failures);
    const modifiedGraph = buildGraph(modifiedIR);

    // Find failure points to seed wavefront
    const failurePoints = new Set<string>();
    for (const link of this.currentIR.topology.links) {
      if (excludedLinks.has(link.id)) {
        failurePoints.add(link.source.node);
        failurePoints.add(link.target.node);
      }
    }
    for (const nodeId of excludedNodes) {
      // Neighbours of failed node
      for (const link of this.currentIR.topology.links) {
        if (link.source.node === nodeId) failurePoints.add(link.target.node);
        if (link.target.node === nodeId) failurePoints.add(link.source.node);
      }
    }

    const steps: ConvergenceStep[] = [];
    const stableNodes = new Set<string>();
    let frontier = [...failurePoints].filter((id) => !excludedNodes.has(id));

    // Tick 0 — initial failure
    steps.push({
      tick: 0,
      updates: { affected_nodes: [...failurePoints], updated_paths: {} },
      stableNodes: [],
      totalStableRatio: 0,
    });

    // BFS wavefront: each tick propagates one hop further
    const visited = new Set<string>(failurePoints);
    let tick = 1;

    while (frontier.length > 0 && tick <= 20) {
      const nextFrontier: string[] = [];
      const tickUpdates: RoutingUpdate["updated_paths"] = {};

      for (const nodeId of frontier) {
        stableNodes.add(nodeId);
        // Compute new paths for this node
        const node = modifiedIR.topology.nodes.find((n) => n.id === nodeId);
        if (node?.vrfs) {
          const changes: { prefix: string; new_next_hop: string | null }[] = [];
          for (const vrf of Object.values(node.vrfs)) {
            for (const route of vrf.routing_table ?? []) {
              if (route.next_hop) {
                const path = this.dijkstraWithGraph(modifiedGraph, nodeId, route.next_hop.split("/")[0]);
                if (!path) changes.push({ prefix: route.prefix, new_next_hop: null });
              }
            }
          }
          if (changes.length > 0) tickUpdates[nodeId] = changes;
        }

        // Expand to neighbours not yet visited
        const neighbours = modifiedGraph.adjacency.get(nodeId) ?? [];
        for (const { neighbor } of neighbours) {
          if (!visited.has(neighbor) && !excludedNodes.has(neighbor)) {
            visited.add(neighbor);
            nextFrontier.push(neighbor);
          }
        }
      }

      // Nodes not yet reached by wavefront are stable (no change needed)
      for (const nodeId of allNodes) {
        if (!visited.has(nodeId)) stableNodes.add(nodeId);
      }

      steps.push({
        tick,
        updates: { affected_nodes: frontier, updated_paths: tickUpdates },
        stableNodes: [...stableNodes],
        totalStableRatio: stableNodes.size / Math.max(allNodes.length, 1),
      });

      frontier = nextFrontier;
      tick++;
    }

    // Final tick — all nodes converged
    for (const nodeId of allNodes) stableNodes.add(nodeId);
    if (frontier.length === 0 || tick > 1) {
      steps.push({
        tick,
        updates: { affected_nodes: [], updated_paths: {} },
        stableNodes: [...stableNodes],
        totalStableRatio: 1,
      });
    }

    return steps;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Return a cloned IR with the given failures applied. */
  private applyFailures(ir: NetXrayIR, failures: FailureSpec[]): NetXrayIR {
    const excludedNodes = new Set<string>(
      failures.filter((f) => f.kind === "node").map((f) => f.id),
    );
    const excludedLinks = new Set<string>(
      failures.filter((f) => f.kind === "link").map((f) => f.id),
    );

    return {
      ...ir,
      topology: {
        nodes: ir.topology.nodes.filter((n) => !excludedNodes.has(n.id)),
        links: ir.topology.links
          .filter((l) => !excludedLinks.has(l.id))
          .filter(
            (l) =>
              !excludedNodes.has(l.source.node) &&
              !excludedNodes.has(l.target.node),
          )
          .map((l) => ({ ...l, state: "up" as const })),
      },
    };
  }

  /** Dijkstra on an arbitrary Graph (by node ID, not IP). */
  private dijkstraWithGraph(graph: Graph, srcId: string, dstId: string): string[] | null {
    // If dst is a full IP, find the node that owns it
    let resolvedDst = dstId;
    if (dstId.includes(".")) {
      // It looks like an IP — find the owning node
      for (const [nodeId, node] of graph.nodes) {
        if (!node.interfaces) continue;
        for (const iface of Object.values(node.interfaces)) {
          if (iface.ip && iface.ip.split("/")[0] === dstId) {
            resolvedDst = nodeId;
            break;
          }
        }
        if (resolvedDst !== dstId) break;
      }
      // Still an IP → not found
      if (resolvedDst === dstId && dstId.includes(".")) return null;
    }

    const dist = new Map<string, number>();
    const prev = new Map<string, string | null>();
    const visited = new Set<string>();

    for (const nodeId of graph.nodes.keys()) {
      dist.set(nodeId, Infinity);
      prev.set(nodeId, null);
    }
    dist.set(srcId, 0);

    while (true) {
      let minNode: string | null = null;
      let minDist = Infinity;
      for (const [nodeId, d] of dist) {
        if (!visited.has(nodeId) && d < minDist) {
          minDist = d;
          minNode = nodeId;
        }
      }
      if (minNode === null) break;
      visited.add(minNode);
      if (minNode === resolvedDst) break;

      for (const { neighbor, cost } of graph.adjacency.get(minNode) ?? []) {
        if (visited.has(neighbor)) continue;
        const newDist = minDist + cost;
        if (newDist < dist.get(neighbor)!) {
          dist.set(neighbor, newDist);
          prev.set(neighbor, minNode);
        }
      }
    }

    if ((dist.get(resolvedDst) ?? Infinity) === Infinity) return null;

    const path: string[] = [];
    let current: string | null = resolvedDst;
    while (current !== null) {
      path.unshift(current);
      current = prev.get(current) ?? null;
    }
    return path;
  }
}

export const mockEngine: SimEngine = new MockEngine();
