import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { ViewDef, ViewResult } from "./index";
import { COLORS } from "../colors";

const DOMAIN_COLORS = [
  { bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.4)", label: "#065f46" },
  { bg: "rgba(6,182,212,0.06)",  border: "rgba(6,182,212,0.4)",  label: "#164e63" },
  { bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.4)", label: "#5b21b6" },
  { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.4)", label: "#92400e" },
];

const UNDERLAY_COLOR = { bg: "rgba(148,163,184,0.06)", border: "rgba(148,163,184,0.4)", label: "#475569" };

function domainColor(idx: number) {
  return DOMAIN_COLORS[idx % DOMAIN_COLORS.length];
}

// ── Derivation ────────────────────────────────────────────────────────────────

function derive(ir: NetXrayIR): ViewResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const nodeMap = new Map(ir.topology.nodes.map((n) => [n.id, n]));

  // ── Step 1: collect VTEP → L2 VNI mappings ──────────────────────────────────
  const vtepVnis = new Map<string, Set<number>>();
  const vniVlans = new Map<number, Set<number>>(); // VNI -> Set of VLANs
  for (const node of ir.topology.nodes) {
    if (!node.evpn?.vnis) continue;
    const l2Vnis = node.evpn.vnis.filter((v) => v.type === "L2");
    if (l2Vnis.length > 0) {
      vtepVnis.set(node.id, new Set(l2Vnis.map(v => v.vni)));
      for (const v of l2Vnis) {
        if (v.vlan) {
          if (!vniVlans.has(v.vni)) vniVlans.set(v.vni, new Set());
          vniVlans.get(v.vni)!.add(v.vlan);
        }
      }
    }
  }

  // ── Step 2: collect physical adjacency (for host→VTEP mapping) ──────────────
  const adjacency = new Map<string, Set<string>>();
  for (const node of ir.topology.nodes) adjacency.set(node.id, new Set());
  for (const link of ir.topology.links) {
    adjacency.get(link.source.node)?.add(link.target.node);
    adjacency.get(link.target.node)?.add(link.source.node);
  }

  // ── Step 3: build L2 domains per VNI ─────────────────────────────────────────
  const domainMembers = new Map<number, Set<string>>();
  for (const [vtepId, vnis] of vtepVnis) {
    for (const vni of vnis) {
      if (!domainMembers.has(vni)) domainMembers.set(vni, new Set());
      domainMembers.get(vni)!.add(vtepId);

      // Include directly-attached hosts (non-VTEP, non-router leaf neighbors)
      for (const neighborId of adjacency.get(vtepId) ?? []) {
        const neighbor = nodeMap.get(neighborId);
        if (neighbor?.type === "host") {
          domainMembers.get(vni)!.add(neighborId);
        }
      }
    }
  }

  // ── Step 4: identify "underlay" nodes (no VNI membership) ───────────────────
  const assignedNodes = new Set([...domainMembers.values()].flatMap((s) => [...s]));
  const underlayNodes = ir.topology.nodes
    .filter((n) => !assignedNodes.has(n.id))
    .map((n) => n.id);

  // ── Step 5: create ReactFlow nodes ───────────────────────────────────────────
  const allGroups: Array<{
    key: string;
    label: string;
    members: string[];
    colorIdx: number;
    isUnderlay: boolean;
  }> = [];

  [...domainMembers.entries()].forEach(([vni, members], idx) => {
    const vlans = vniVlans.get(vni);
    let label = `L2 VNI ${vni}`;
    if (vlans && vlans.size > 0) {
      label += ` (VLAN ${[...vlans].join(",")})`;
    }
    allGroups.push({
      key: `vni-${vni}`,
      label,
      members: [...members],
      colorIdx: idx,
      isUnderlay: false,
    });
  });

  if (underlayNodes.length > 0) {
    allGroups.push({
      key: "underlay",
      label: "Underlay / IP",
      members: underlayNodes,
      colorIdx: 0,
      isUnderlay: true,
    });
  }

  for (const g of allGroups) {
    const groupId = `group-${g.key}`;
    const color = g.isUnderlay ? UNDERLAY_COLOR : domainColor(g.colorIdx);

    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 0, y: 0 },
      data: { label: g.label },
      style: {
        backgroundColor: color.bg,
        border: `1.5px solid ${color.border}`,
        borderRadius: 10,
      },
    });

    g.members.forEach((nodeId) => {
      const node = nodeMap.get(nodeId)!;

      nodes.push({
        id: node.id,
        type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
        parentId: groupId,
        extent: "parent",
        position: { x: 0, y: 0 },
        data: { ...node },
        style: { zIndex: 1 },
      });
    });
  }

  // ── Step 6: VTEP-to-VTEP EVPN fabric edges (shared L2 VNI) ──────────────────
  const seenEvpnEdges = new Set<string>();
  for (const [vni, members] of domainMembers) {
    const vtepList = [...members].filter((id) => vtepVnis.has(id));
    for (let i = 0; i < vtepList.length; i++) {
      for (let j = i + 1; j < vtepList.length; j++) {
        const key = [vtepList[i], vtepList[j]].sort().join("~~");
        if (seenEvpnEdges.has(key)) continue;
        seenEvpnEdges.add(key);
        edges.push({
          id: `l2-evpn-${vni}-${key}`,
          source: vtepList[i],
          target: vtepList[j],
          type: "default",
          animated: false,
          label: `VNI ${vni}`,
          style: {
            stroke: "#06b6d4",
            strokeWidth: 2,
            strokeDasharray: "6,3",
          },
          labelStyle: { fontSize: 10, fill: "#0e7490" },
          labelBgStyle: { fill: "rgba(255,255,255,0.85)" },
        });
      }
    }
  }

  // ── Step 7: physical host ↔ VTEP links within domains ───────────────────────
  for (const link of ir.topology.links) {
    const srcNode = nodeMap.get(link.source.node);
    const dstNode = nodeMap.get(link.target.node);
    if (!srcNode || !dstNode) continue;
    // Only include links where at least one end is a host (access links)
    if (srcNode.type !== "host" && dstNode.type !== "host") continue;

    edges.push({
      id: `l2-phy-${link.id}`,
      source: link.source.node,
      target: link.target.node,
      type: "network",
      animated: false,
      data: {
        state: link.state,
        sourceInterface: link.source.interface,
        targetInterface: link.target.interface,
        isOnPath: false,
      },
      style:
        link.state === "down"
          ? { stroke: COLORS.DOWN, strokeDasharray: "5,5" }
          : { stroke: COLORS.NEUTRAL },
    });
  }

  return { nodes, edges };
}

export const l2View: ViewDef = {
  id: "l2",
  label: "L2 / VXLAN",
  description: "L2 broadcast domains grouped by EVPN VNI",
  color: "#06b6d4",
  needsLayout: true,
  isAvailable: (ir) => ir.topology.nodes.some((n) => n.evpn?.vnis?.some((v) => v.type === "L2")),
  derive,
};
