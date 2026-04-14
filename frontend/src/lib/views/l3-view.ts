/**
 * l3-view.ts — L3 / BGP AS hierarchical view.
 *
 * Groups nodes by their BGP `local_as`. Each AS becomes a ReactFlow parent
 * (group) node. Nodes without BGP config are placed in an "Unmanaged" group.
 *
 * Edges shown:
 *  - eBGP sessions between nodes in different AS groups
 *  - Physical links that cross AS boundaries
 *
 * Layout: groups are tiled left-to-right (up to 3 per row), members are
 * arranged in a 2-column grid inside each group.
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { ViewDef, ViewResult } from "./index";
import { COLORS } from "../colors";
import { CHILD_W, CHILD_H, CHILD_COLS, CHILD_GAP_X, CHILD_GAP_Y, GROUP_PAD_X, GROUP_PAD_Y, GROUP_GAP_X, GROUP_GAP_Y, GROUPS_PER_ROW } from "./layout-constants";

// ── Colors per AS (cycle through palette) ────────────────────────────────────

const GROUP_COLORS = [
  { bg: "rgba(59,130,246,0.06)", border: "rgba(59,130,246,0.35)", label: "#1d4ed8" },
  { bg: "rgba(16,185,129,0.06)", border: "rgba(16,185,129,0.35)", label: "#065f46" },
  { bg: "rgba(245,158,11,0.06)", border: "rgba(245,158,11,0.35)", label: "#92400e" },
  { bg: "rgba(139,92,246,0.06)", border: "rgba(139,92,246,0.35)", label: "#5b21b6" },
  { bg: "rgba(239,68,68,0.06)", border: "rgba(239,68,68,0.35)", label: "#991b1b" },
];

function groupColor(idx: number) {
  return GROUP_COLORS[idx % GROUP_COLORS.length];
}

// ── Sizing helpers ────────────────────────────────────────────────────────────

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

  // ── Step 1: bucket nodes by AS ──────────────────────────────────────────────
  const asBuckets = new Map<number | "unmanaged", string[]>();
  const nodeAs = new Map<string, number>();

  for (const node of ir.topology.nodes) {
    const as = node.bgp?.local_as ?? "unmanaged";
    if (!asBuckets.has(as)) asBuckets.set(as, []);
    asBuckets.get(as)!.push(node.id);
    if (typeof as === "number") nodeAs.set(node.id, as);
  }

  // ── Step 2: pre-compute group positions ─────────────────────────────────────
  const groupEntries = [...asBuckets.entries()];
  const groupPositions = new Map<number | "unmanaged", { x: number; y: number }>();
  let cursorX = 0;
  let cursorY = 0;
  let maxRowH = 0;

  groupEntries.forEach(([as, members], idx) => {
    if (idx > 0 && idx % GROUPS_PER_ROW === 0) {
      cursorX = 0;
      cursorY += maxRowH + GROUP_GAP_Y;
      maxRowH = 0;
    }
    const { w, h } = groupSize(members.length);
    groupPositions.set(as, { x: cursorX, y: cursorY });
    cursorX += w + GROUP_GAP_X;
    if (h > maxRowH) maxRowH = h;
  });

  // ── Step 3: create group + child nodes ──────────────────────────────────────
  const nodeIdMap = new Map<string, typeof ir.topology.nodes[number]>();
  for (const n of ir.topology.nodes) nodeIdMap.set(n.id, n);

  groupEntries.forEach(([as, members], gIdx) => {
    const groupId = `group-as-${as}`;
    const pos = groupPositions.get(as)!;
    const { w, h } = groupSize(members.length);
    const color = groupColor(gIdx);
    const label = as === "unmanaged" ? "Unmanaged" : `AS ${as}`;

    // Parent group node
    nodes.push({
      id: groupId,
      type: "group",
      position: pos,
      data: { label },
      style: {
        width: w,
        height: h,
        backgroundColor: color.bg,
        border: `1.5px solid ${color.border}`,
        borderRadius: 10,
      },
      // Group nodes are not interactive themselves
      selectable: false,
      draggable: false,
    });

    // Child nodes — positioned relative to the group
    members.forEach((nodeId, mIdx) => {
      const node = nodeIdMap.get(nodeId)!;
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
    });
  });

  // ── Step 4: eBGP edges (cross-AS BGP sessions) ───────────────────────────────
  const seenBgpEdges = new Set<string>();

  for (const node of ir.topology.nodes) {
    if (!node.bgp?.sessions) continue;
    for (const session of node.bgp.sessions) {
      if (!session.peer_node) continue;
      const srcAs = nodeAs.get(node.id);
      const dstAs = nodeAs.get(session.peer_node);
      // Only show eBGP (different AS)
      if (srcAs === dstAs) continue;

      const edgeKey = [node.id, session.peer_node].sort().join("~~");
      if (seenBgpEdges.has(edgeKey)) continue;
      seenBgpEdges.add(edgeKey);

      const isEstablished = session.state === "established";
      edges.push({
        id: `l3-bgp-${edgeKey}`,
        source: node.id,
        target: session.peer_node,
        type: "bgp",
        animated: isEstablished,
        data: {
          sourceAs: node.bgp.local_as,
          targetAs: session.remote_as,
          state: session.state,
          sourceRole: session.role ?? null,
        },
        style: {
          stroke: isEstablished ? COLORS.WARN : COLORS.NEUTRAL,
          strokeWidth: 2,
          strokeDasharray: isEstablished ? undefined : "8,4",
        },
      });
    }
  }

  // ── Step 5: physical cross-AS links ─────────────────────────────────────────
  for (const link of ir.topology.links) {
    const srcAs = nodeAs.get(link.source.node);
    const dstAs = nodeAs.get(link.target.node);
    // Only cross-AS physical links (intra-AS physical links are implicit from the group)
    if (srcAs === dstAs && srcAs !== undefined) continue;

    edges.push({
      id: `l3-phy-${link.id}`,
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
          : { stroke: COLORS.NEUTRAL, strokeWidth: 1.5 },
    });
  }

  return { nodes, edges };
}

export const l3View: ViewDef = {
  id: "l3",
  label: "L3 / BGP AS",
  description: "Group nodes by BGP AS, show eBGP inter-AS sessions",
  color: "#f59e0b",
  needsLayout: false,
  isAvailable: (ir) => ir.topology.nodes.some((n) => n.bgp),
  derive,
};
