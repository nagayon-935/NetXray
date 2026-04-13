/**
 * ir-diff.ts — Structural diff between two NetXrayIR snapshots.
 *
 * Generalises the simple `diffSnapshots` in snapshot-store to cover:
 *  - Node additions / removals
 *  - Link state changes  (up ↔ down)
 *  - Interface state changes
 *  - Routing-table prefix changes (next-hop added, removed, or changed)
 *  - ACL rule additions / removals
 */

import type { NetXrayIR, AclRule } from "../types/netxray-ir";

// ── Core diff types ──────────────────────────────────────────────────────────

export interface NodeChange {
  nodeId: string;
  kind: "added" | "removed";
}

export interface LinkChange {
  linkId: string;
  from: "up" | "down";
  to: "up" | "down";
}

export interface InterfaceChange {
  nodeId: string;
  ifName: string;
  from: "up" | "down";
  to: "up" | "down";
}

export interface RouteChange {
  nodeId: string;
  vrf: string;
  prefix: string;
  kind: "added" | "removed" | "changed";
  /** next-hop before the change (null = directly connected / was not present). */
  before: string | null;
  /** next-hop after the change (null = withdrawn / no route). */
  after: string | null;
}

export interface AclChange {
  aclName: string;
  seq: number;
  kind: "added" | "removed";
  rule: AclRule;
}

export interface IRDiff {
  nodeChanges: NodeChange[];
  linkChanges: LinkChange[];
  interfaceChanges: InterfaceChange[];
  routeChanges: RouteChange[];
  aclChanges: AclChange[];
  /** True when absolutely nothing differs. */
  isEmpty: boolean;
}

// ── Main diff function ───────────────────────────────────────────────────────

/**
 * Compute a full structural diff between `base` and `current` IR snapshots.
 * All comparisons are by value equality; object identity is not used.
 */
export function diffIR(base: NetXrayIR, current: NetXrayIR): IRDiff {
  const nodeChanges = diffNodes(base, current);
  const linkChanges = diffLinks(base, current);
  const interfaceChanges = diffInterfaces(base, current);
  const routeChanges = diffRoutes(base, current);
  const aclChanges = diffAcls(base, current);

  const isEmpty =
    nodeChanges.length === 0 &&
    linkChanges.length === 0 &&
    interfaceChanges.length === 0 &&
    routeChanges.length === 0 &&
    aclChanges.length === 0;

  return { nodeChanges, linkChanges, interfaceChanges, routeChanges, aclChanges, isEmpty };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function diffNodes(base: NetXrayIR, current: NetXrayIR): NodeChange[] {
  const baseIds = new Set(base.topology.nodes.map((n) => n.id));
  const currentIds = new Set(current.topology.nodes.map((n) => n.id));

  const changes: NodeChange[] = [];
  for (const id of currentIds) {
    if (!baseIds.has(id)) changes.push({ nodeId: id, kind: "added" });
  }
  for (const id of baseIds) {
    if (!currentIds.has(id)) changes.push({ nodeId: id, kind: "removed" });
  }
  return changes;
}

function diffLinks(base: NetXrayIR, current: NetXrayIR): LinkChange[] {
  const baseMap = new Map(base.topology.links.map((l) => [l.id, l.state]));
  const changes: LinkChange[] = [];
  for (const link of current.topology.links) {
    const baseState = baseMap.get(link.id);
    if (baseState !== undefined && baseState !== link.state) {
      changes.push({ linkId: link.id, from: baseState, to: link.state });
    }
  }
  return changes;
}

function diffInterfaces(base: NetXrayIR, current: NetXrayIR): InterfaceChange[] {
  const changes: InterfaceChange[] = [];

  const baseNodeMap = new Map(base.topology.nodes.map((n) => [n.id, n]));
  for (const node of current.topology.nodes) {
    const baseNode = baseNodeMap.get(node.id);
    if (!baseNode?.interfaces || !node.interfaces) continue;

    for (const [ifName, iface] of Object.entries(node.interfaces)) {
      const baseIface = baseNode.interfaces[ifName];
      if (baseIface && baseIface.state !== iface.state) {
        changes.push({
          nodeId: node.id,
          ifName,
          from: baseIface.state,
          to: iface.state,
        });
      }
    }
  }
  return changes;
}

function diffRoutes(base: NetXrayIR, current: NetXrayIR): RouteChange[] {
  const changes: RouteChange[] = [];

  const baseNodeMap = new Map(base.topology.nodes.map((n) => [n.id, n]));

  for (const node of current.topology.nodes) {
    const baseNode = baseNodeMap.get(node.id);
    if (!node.vrfs) continue;

    for (const [vrfName, vrf] of Object.entries(node.vrfs)) {
      const baseVrf = baseNode?.vrfs?.[vrfName];
      const baseRouteMap = new Map(
        (baseVrf?.routing_table ?? []).map((r) => [r.prefix, r.next_hop])
      );
      const currentRouteMap = new Map(
        (vrf.routing_table ?? []).map((r) => [r.prefix, r.next_hop])
      );

      // Added or changed
      for (const [prefix, nextHop] of currentRouteMap) {
        if (!baseRouteMap.has(prefix)) {
          changes.push({ nodeId: node.id, vrf: vrfName, prefix, kind: "added", before: null, after: nextHop });
        } else if (baseRouteMap.get(prefix) !== nextHop) {
          changes.push({
            nodeId: node.id,
            vrf: vrfName,
            prefix,
            kind: "changed",
            before: baseRouteMap.get(prefix) ?? null,
            after: nextHop,
          });
        }
      }

      // Removed
      for (const [prefix, nextHop] of baseRouteMap) {
        if (!currentRouteMap.has(prefix)) {
          changes.push({ nodeId: node.id, vrf: vrfName, prefix, kind: "removed", before: nextHop, after: null });
        }
      }
    }
  }

  return changes;
}

function diffAcls(base: NetXrayIR, current: NetXrayIR): AclChange[] {
  const changes: AclChange[] = [];

  const baseAcls = base.policies?.acls ?? {};
  const currentAcls = current.policies?.acls ?? {};
  const allAclNames = new Set([...Object.keys(baseAcls), ...Object.keys(currentAcls)]);

  for (const aclName of allAclNames) {
    const baseRules = baseAcls[aclName] ?? [];
    const currentRules = currentAcls[aclName] ?? [];

    const baseSeqMap = new Map(baseRules.map((r) => [r.seq, r]));
    const currentSeqMap = new Map(currentRules.map((r) => [r.seq, r]));

    for (const [seq, rule] of currentSeqMap) {
      if (!baseSeqMap.has(seq)) {
        changes.push({ aclName, seq, kind: "added", rule });
      }
    }
    for (const [seq, rule] of baseSeqMap) {
      if (!currentSeqMap.has(seq)) {
        changes.push({ aclName, seq, kind: "removed", rule });
      }
    }
  }

  return changes;
}

// ── Convenience re-export ────────────────────────────────────────────────────

/**
 * Lightweight summary suitable for snapshot diff display.
 * Kept backward-compatible with the existing `SnapshotDiff` shape from snapshot-store.
 */
export function diffSummary(base: NetXrayIR, current: NetXrayIR) {
  const diff = diffIR(base, current);
  return {
    nodesAdded: diff.nodeChanges.filter((c) => c.kind === "added").map((c) => c.nodeId),
    nodesRemoved: diff.nodeChanges.filter((c) => c.kind === "removed").map((c) => c.nodeId),
    linkChanges: diff.linkChanges.map((c) => ({ id: c.linkId, from: c.from, to: c.to })),
    routeChanges: diff.routeChanges,
    aclChanges: diff.aclChanges,
  };
}
