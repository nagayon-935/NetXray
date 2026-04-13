/**
 * l2-view.ts — L2 broadcast domain view.
 *
 * Groups VTEP nodes (nodes with EVPN config) and their directly-attached
 * hosts by shared L2 VNIs. Nodes without VNI membership (e.g. pure-IP spines)
 * are shown separately as "Underlay" nodes.
 *
 * Edges shown:
 *  - Physical links within each domain (VTEP ↔ host)
 *  - VTEP-to-VTEP dashed edges for shared L2 VNIs (EVPN fabric peers)
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { ViewDef, ViewResult } from "./index";

// ── Layout constants ─────────────────────────────────────────────────────────

const CHILD_W = 190;
const CHILD_H = 70;
const CHILD_COLS = 2;
const CHILD_GAP_X = 20;
const CHILD_GAP_Y = 20;
const GROUP_PAD_X = 30;
const GROUP_PAD_Y = 50;
const GROUP_GAP_X = 80;
const GROUP_GAP_Y = 80;
const GROUPS_PER_ROW = 3;

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

function groupSize(memberCount: number) {
  const cols = Math.min(memberCount, CHILD_COLS);
  const rows = Math.ceil(memberCount / CHILD_COLS);
  const w = cols * CHILD_W + (cols - 1) * CHILD_GAP_X + GROUP_PAD_X * 2;
  const h = rows * CHILD_H + (rows - 1) * CHILD_GAP_Y + GROUP_PAD_Y + GROUP_PAD_X;
  return { w: Math.max(w, 260), h: Math.max(h, 120) };
}

// ── Derivation ────────────────────────────────────────────────────────────────

function derive(ir: NetXrayIR): ViewResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const nodeMap = new Map(ir.topology.nodes.map((n) => [n.id, n]));

  // ── Step 1: collect VTEP → L2 VNI mappings ──────────────────────────────────
  // vtepVnis: vtep node ID → Set of L2 VNI numbers
  const vtepVnis = new Map<string, Set<number>>();
  for (const node of ir.topology.nodes) {
    if (!node.evpn?.vnis) continue;
    const l2Vnis = node.evpn.vnis.filter((v) => v.type === "L2").map((v) => v.vni);
    if (l2Vnis.length > 0) {
      vtepVnis.set(node.id, new Set(l2Vnis));
    }
  }

  // ── Step 2: collect physical adjacency (for host→VTEP mapping) ──────────────
  // adjacency: node ID → set of directly connected node IDs
  const adjacency = new Map<string, Set<string>>();
  for (const node of ir.topology.nodes) adjacency.set(node.id, new Set());
  for (const link of ir.topology.links) {
    adjacency.get(link.source.node)?.add(link.target.node);
    adjacency.get(link.target.node)?.add(link.source.node);
  }

  // ── Step 3: build L2 domains per VNI ─────────────────────────────────────────
  // domainMembers: VNI → Set of node IDs (VTEPs + directly-attached hosts)
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

  // ── Step 5: compute group positions ─────────────────────────────────────────
  const allGroups: Array<{
    key: string;
    label: string;
    members: string[];
    colorIdx: number;
    isUnderlay: boolean;
  }> = [];

  [...domainMembers.entries()].forEach(([vni, members], idx) => {
    allGroups.push({
      key: `vni-${vni}`,
      label: `L2 VNI ${vni}`,
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

  const groupPositions = new Map<string, { x: number; y: number }>();
  let cursorX = 0;
  let cursorY = 0;
  let maxRowH = 0;

  allGroups.forEach((g, idx) => {
    if (idx > 0 && idx % GROUPS_PER_ROW === 0) {
      cursorX = 0;
      cursorY += maxRowH + GROUP_GAP_Y;
      maxRowH = 0;
    }
    const { w, h } = groupSize(g.members.length);
    groupPositions.set(g.key, { x: cursorX, y: cursorY });
    cursorX += w + GROUP_GAP_X;
    if (h > maxRowH) maxRowH = h;
  });

  // ── Step 6: create ReactFlow nodes ───────────────────────────────────────────
  const nodeGroupMap = new Map<string, string>(); // nodeId → groupKey

  for (const g of allGroups) {
    const groupId = `group-${g.key}`;
    const pos = groupPositions.get(g.key)!;
    const { w, h } = groupSize(g.members.length);
    const color = g.isUnderlay ? UNDERLAY_COLOR : domainColor(g.colorIdx);

    nodes.push({
      id: groupId,
      type: "group",
      position: pos,
      data: { label: g.label },
      style: {
        width: w,
        height: h,
        backgroundColor: color.bg,
        border: `1.5px solid ${color.border}`,
        borderRadius: 10,
      },
      selectable: false,
      draggable: false,
    });

    g.members.forEach((nodeId, mIdx) => {
      const node = nodeMap.get(nodeId)!;
      const col = mIdx % CHILD_COLS;
      const row = Math.floor(mIdx / CHILD_COLS);
      const relX = GROUP_PAD_X + col * (CHILD_W + CHILD_GAP_X);
      const relY = GROUP_PAD_Y + row * (CHILD_H + CHILD_GAP_Y);

      nodes.push({
        id: node.id,
        type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
        parentId: groupId,
        extent: "parent",
        position: { x: relX, y: relY },
        data: { ...node },
        style: { zIndex: 1 },
      });

      nodeGroupMap.set(nodeId, g.key);
    });
  }

  // ── Step 7: VTEP-to-VTEP EVPN fabric edges (shared L2 VNI) ──────────────────
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

  // ── Step 8: physical host ↔ VTEP links within domains ───────────────────────
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
          ? { stroke: "#ef4444", strokeDasharray: "5,5" }
          : { stroke: "#94a3b8" },
    });
  }

  return { nodes, edges };
}

export const l2View: ViewDef = {
  id: "l2",
  label: "L2 / VXLAN",
  description: "L2 broadcast domains grouped by EVPN VNI",
  color: "#06b6d4",
  needsLayout: false,
  isAvailable: (ir) => ir.topology.nodes.some((n) => n.evpn?.vnis?.some((v) => v.type === "L2")),
  derive,
};
