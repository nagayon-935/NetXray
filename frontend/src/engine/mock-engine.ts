import type { NetXrayIR, Node, Link, AclRule } from "../types/netxray-ir";
import type {
  SimEngine,
  PacketHeader,
  PacketPath,
  PathHop,
  PacketLayer,
  ShadowedRule,
  AclEvaluation,
} from "./types";

interface Graph {
  adjacency: Map<string, { neighbor: string; link: Link; cost: number }[]>;
  nodes: Map<string, Node>;
}

// Deterministic locally-administered MAC for interfaces lacking a collected one.
function synthMac(nodeId: string, iface: string): string {
  let h = 0;
  const s = `${nodeId}/${iface}`;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  const b = [
    (h >>> 24) & 0xff,
    (h >>> 16) & 0xff,
    (h >>> 8) & 0xff,
    h & 0xff,
    (h >>> 5) & 0xff,
  ].map((n) => n.toString(16).padStart(2, "0"));
  // 02: => locally administered, unicast
  return `02:${b[0]}:${b[1]}:${b[2]}:${b[3]}:${b[4]}`;
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

    adjacency.get(link.source.node)!.push({ neighbor: link.target.node, link, cost: srcCost });
    adjacency.get(link.target.node)!.push({ neighbor: link.source.node, link, cost: tgtCost });
  }

  return { adjacency, nodes };
}

function evaluateAclRules(
  aclRules: AclRule[],
  packet: PacketHeader,
): { rule: AclRule | null; action: "permit" | "deny" | "no-match" } {
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

// Overlay applied on the underlay segments between two encap endpoints on the path.
type Overlay =
  | {
      type: "vxlan";
      startIdx: number;
      endIdx: number;
      outerSrc: string;
      outerDst: string;
      vni: number;
    }
  | {
      type: "srv6";
      startIdx: number;
      endIdx: number;
      waypoints: number[]; // path indices of SRv6 nodes
      sids: string[]; // SID per waypoint (parallel to `waypoints`)
      srcSid: string; // headend locator (outer IPv6 source)
    }
  | null;

class MockEngine implements SimEngine {
  private currentIR: NetXrayIR | null = null;
  private graph: Graph | null = null;

  loadTopology(ir: NetXrayIR): void {
    this.currentIR = ir;
    this.graph = buildGraph(ir);
  }

  simulatePacket(packet: PacketHeader): PacketPath {
    // Echo Request travels src→dst. Intermediate routers only forward it.
    const forward = this.tracePath(packet, "echo-request");

    // Request/reply is an ICMP-echo concept only: the *destination host*
    // returns an Echo Reply (dst→src), and only if the request was delivered.
    // TCP/UDP single-packet sims have no such guaranteed reply.
    if (packet.protocol === "icmp" && forward.result === "delivered") {
      const replyPacket: PacketHeader = {
        src_ip: packet.dst_ip,
        dst_ip: packet.src_ip,
        protocol: "icmp",
      };
      forward.reply = this.tracePath(replyPacket, "echo-reply");
    }
    return forward;
  }

  private tracePath(packet: PacketHeader, icmpMessage: "echo-request" | "echo-reply"): PacketPath {
    if (!this.currentIR || !this.graph) {
      return { hops: [], result: "unreachable", drop_reason: "No topology loaded" };
    }

    const srcNode = this.findNodeByIp(packet.src_ip);
    const dstNode = this.findNodeByIp(packet.dst_ip);

    if (!srcNode) return { hops: [], result: "unreachable", drop_reason: `Source IP ${packet.src_ip} not found` };
    if (!dstNode) return { hops: [], result: "unreachable", drop_reason: `Destination IP ${packet.dst_ip} not found` };

    const path = this.dijkstra(srcNode.id, dstNode.id);
    if (!path) return { hops: [], result: "unreachable", drop_reason: "No route to destination" };

    const overlay = this.computeOverlay(path);
    const hops: PathHop[] = [];

    for (let i = 0; i < path.length; i++) {
      const nodeId = path[i];
      const node: Node = this.graph.nodes.get(nodeId)!;
      const prevNodeId = i > 0 ? path[i - 1] : null;
      const nextNodeId = i < path.length - 1 ? path[i + 1] : null;
      // The stack shows the egress segment (i→i+1); the last hop shows its ingress segment.
      const segmentIdx = nextNodeId ? i : i - 1;
      let ingressIface: string | null = null;
      let egressIface: string | null = null;

      if (prevNodeId) {
        const prevLink = this.findLinkBetween(prevNodeId, nodeId);
        if (prevLink) {
          ingressIface = prevLink.source.node === nodeId
            ? prevLink.source.interface
            : prevLink.target.interface;
        }
      }

      if (nextNodeId) {
        const nextLink = this.findLinkBetween(nodeId, nextNodeId);
        if (nextLink) {
          egressIface = nextLink.source.node === nodeId
            ? nextLink.source.interface
            : nextLink.target.interface;
        }
      }

      const packetStack = this.buildPacketStack(packet, icmpMessage, overlay, segmentIdx, {
        nodeId,
        ingressIface,
        egressIface,
        prevNodeId,
        nextNodeId,
      });

      if (ingressIface && node.interfaces?.[ingressIface]?.acl_in) {
        const aclName = node.interfaces[ingressIface].acl_in!;
        const aclRules = this.currentIR.policies?.acls?.[aclName];
        if (aclRules) {
          const result = evaluateAclRules(aclRules, packet);
          const hop: PathHop = {
            node_id: nodeId,
            ingress_interface: ingressIface,
            egress_interface: egressIface,
            packet_stack: packetStack,
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
        packet_stack: packetStack,
      });
    }

    return { hops, result: "delivered" };
  }

  // Pick the overlay (if any) applied on the underlay between two encap endpoints.
  // SRv6 takes precedence over VXLAN (EVPN-over-SRv6 replaces VXLAN transport).
  private computeOverlay(path: string[]): Overlay {
    const g = this.graph!;
    const sidOf = (n: Node): string =>
      n.srv6?.sids?.[0]?.sid ?? n.srv6?.locator ?? "";

    const srv6 = path
      .map((id, i) => ({ i, node: g.nodes.get(id)! }))
      .filter((w) => (w.node.srv6?.sids?.length ?? 0) > 0 || !!w.node.srv6?.locator);
    if (srv6.length >= 2) {
      return {
        type: "srv6",
        startIdx: srv6[0].i,
        endIdx: srv6[srv6.length - 1].i,
        waypoints: srv6.map((w) => w.i),
        sids: srv6.map((w) => sidOf(w.node)),
        srcSid: srv6[0].node.srv6?.locator ?? sidOf(srv6[0].node),
      };
    }

    const vteps = path
      .map((id, i) => ({ i, node: g.nodes.get(id)! }))
      .filter((w) => !!w.node.evpn?.vtep_ip);
    if (vteps.length >= 2) {
      const ingress = vteps[0].node;
      const egress = vteps[vteps.length - 1].node;
      return {
        type: "vxlan",
        startIdx: vteps[0].i,
        endIdx: vteps[vteps.length - 1].i,
        outerSrc: ingress.evpn!.vtep_ip!,
        outerDst: egress.evpn!.vtep_ip!,
        vni: ingress.evpn!.vnis?.[0]?.vni ?? 0,
      };
    }
    return null;
  }

  // Build the header stack as framed on this hop's wire (outer→inner).
  // L2 MACs are rewritten per segment; on underlay segments inside an overlay
  // the original packet is wrapped in VXLAN or SRv6 outer headers.
  private buildPacketStack(
    packet: PacketHeader,
    icmpMessage: "echo-request" | "echo-reply",
    overlay: Overlay,
    segmentIdx: number,
    ctx: {
      nodeId: string;
      ingressIface: string | null;
      egressIface: string | null;
      prevNodeId: string | null;
      nextNodeId: string | null;
    }
  ): PacketLayer[] {
    // Real MAC if collected; otherwise a deterministic per-interface fallback
    // so the L2 rewrite is still visible on topologies without MAC data.
    const macOf = (nodeId: string | null, iface: string | null): string | null =>
      nodeId && iface
        ? this.graph?.nodes.get(nodeId)?.interfaces?.[iface]?.mac ?? synthMac(nodeId, iface)
        : null;

    const ifaceOnLink = (link: Link | null, nodeId: string): string | null =>
      link ? (link.source.node === nodeId ? link.source.interface : link.target.interface) : null;

    let srcMac: string | null = null;
    let dstMac: string | null = null;
    if (ctx.egressIface && ctx.nextNodeId) {
      // Framing on the egress segment toward the next node.
      const nextLink = this.findLinkBetween(ctx.nodeId, ctx.nextNodeId);
      srcMac = macOf(ctx.nodeId, ctx.egressIface);
      dstMac = macOf(ctx.nextNodeId, ifaceOnLink(nextLink, ctx.nextNodeId));
    } else if (ctx.ingressIface && ctx.prevNodeId) {
      // Final hop: framing as received on the ingress segment.
      const prevLink = this.findLinkBetween(ctx.prevNodeId, ctx.nodeId);
      srcMac = macOf(ctx.prevNodeId, ifaceOnLink(prevLink, ctx.prevNodeId));
      dstMac = macOf(ctx.nodeId, ctx.ingressIface);
    }

    // This segment is encapsulated if it lies on the underlay between the endpoints.
    const encapsulated =
      !!overlay && segmentIdx >= overlay.startIdx && segmentIdx < overlay.endIdx;

    const l4: PacketLayer[] = [];
    if (packet.protocol === "tcp" || packet.protocol === "udp") {
      l4.push({ kind: packet.protocol, src_port: packet.src_port, dst_port: packet.dst_port });
    } else if (packet.protocol === "icmp") {
      l4.push({ kind: "icmp", message: icmpMessage });
    }

    const ethernet: PacketLayer = { kind: "ethernet", src_mac: srcMac, dst_mac: dstMac };

    if (!encapsulated || !overlay) {
      return [ethernet, { kind: "ipv4", src: packet.src_ip, dst: packet.dst_ip }, ...l4];
    }

    const innerIp: PacketLayer = {
      kind: "ipv4",
      src: packet.src_ip,
      dst: packet.dst_ip,
      role: "inner",
    };

    let outer: PacketLayer[];
    if (overlay.type === "vxlan") {
      outer = [
        { kind: "ipv4", src: overlay.outerSrc, dst: overlay.outerDst, role: "outer" },
        { kind: "udp", dst_port: 4789 },
        { kind: "vxlan", vni: overlay.vni },
      ];
    } else {
      // SRv6: outer IPv6 dst = active SID (next waypoint ahead of this segment).
      const ahead = overlay.waypoints.filter((w) => w > segmentIdx);
      const activeSid =
        ahead.length > 0
          ? overlay.sids[overlay.waypoints.indexOf(ahead[0])]
          : overlay.sids[overlay.sids.length - 1];
      outer = [
        { kind: "ipv6", src: overlay.srcSid, dst: activeSid, role: "outer" },
        { kind: "srh", segments: overlay.sids, segments_left: Math.max(0, ahead.length - 1) },
      ];
    }

    return [ethernet, ...outer, innerIp, ...l4];
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

  evaluateAcl(aclName: string, packet: PacketHeader): AclEvaluation {
    const rules = this.currentIR?.policies?.acls?.[aclName];
    if (!rules) return { acl_name: aclName, matched_seq: null, action: "no-match" };
    const result = evaluateAclRules(rules, packet);
    return {
      acl_name: aclName,
      matched_seq: result.rule?.seq ?? null,
      action: result.action,
    };
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
    const graph = this.graph;
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
      if (minNode === dstId) break;

      for (const { neighbor, cost } of graph.adjacency.get(minNode) ?? []) {
        if (visited.has(neighbor)) continue;
        const newDist = minDist + cost;
        if (newDist < dist.get(neighbor)!) {
          dist.set(neighbor, newDist);
          prev.set(neighbor, minNode);
        }
      }
    }

    if ((dist.get(dstId) ?? Infinity) === Infinity) return null;

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
}

export const mockEngine: SimEngine = new MockEngine();
