/**
 * overlay-view.ts — EVPN / SRv6 overlay topology view.
 *
 * Focuses on the overlay fabric:
 *  - VTEP nodes (any node with EVPN config) shown with their VNI counts
 *  - SRv6 nodes shown with their locator prefix
 *  - L3 VNI peering edges between VTEPs sharing the same L3 VNI (RT match)
 *  - SRv6 adjacency shown as dashed purple edges
 *  - Pure-IP-only nodes (no EVPN, no SRv6) shown separately as "Underlay"
 *
 * Layout: two rows — overlay nodes on top, underlay on bottom.
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { ViewDef, ViewResult } from "./index";

// ── Layout constants ─────────────────────────────────────────────────────────

const NODE_W = 190;
const NODE_H = 70;
const NODE_GAP_X = 40;
const NODE_GAP_Y = 60;
const NODES_PER_ROW = 4;
const SECTION_GAP_Y = 120; // vertical gap between overlay and underlay rows

// ── Helpers ───────────────────────────────────────────────────────────────────

function gridPosition(idx: number, startY: number) {
  const col = idx % NODES_PER_ROW;
  const row = Math.floor(idx / NODES_PER_ROW);
  return {
    x: col * (NODE_W + NODE_GAP_X),
    y: startY + row * (NODE_H + NODE_GAP_Y),
  };
}

function rowsNeeded(count: number) {
  return Math.ceil(count / NODES_PER_ROW);
}

// ── Derivation ────────────────────────────────────────────────────────────────

function derive(ir: NetXrayIR): ViewResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const nodeMap = new Map(ir.topology.nodes.map((n) => [n.id, n]));

  // Classify nodes
  const overlayNodes: string[] = [];
  const underlayNodes: string[] = [];

  for (const node of ir.topology.nodes) {
    if (node.evpn || node.srv6) {
      overlayNodes.push(node.id);
    } else {
      underlayNodes.push(node.id);
    }
  }

  // ── Compute positions ────────────────────────────────────────────────────────
  const overlayRowsH = rowsNeeded(overlayNodes.length) * (NODE_H + NODE_GAP_Y);
  const underlayStartY = overlayRowsH + SECTION_GAP_Y;

  const posMap = new Map<string, { x: number; y: number }>();
  overlayNodes.forEach((id, i) => posMap.set(id, gridPosition(i, 0)));
  underlayNodes.forEach((id, i) => posMap.set(id, gridPosition(i, underlayStartY)));

  // ── Create FlowNodes ─────────────────────────────────────────────────────────
  for (const node of ir.topology.nodes) {
    const pos = posMap.get(node.id) ?? { x: 0, y: 0 };
    const isOverlay = overlayNodes.includes(node.id);

    // Build data with overlay annotations
    const overlayLabel = [];
    if (node.evpn?.vnis) {
      const l2Count = node.evpn.vnis.filter((v) => v.type === "L2").length;
      const l3Count = node.evpn.vnis.filter((v) => v.type === "L3").length;
      if (l2Count > 0) overlayLabel.push(`L2×${l2Count}`);
      if (l3Count > 0) overlayLabel.push(`L3×${l3Count}`);
    }
    if (node.srv6?.locator) overlayLabel.push(`SRv6:${node.srv6.locator}`);

    nodes.push({
      id: node.id,
      type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
      position: pos,
      data: {
        ...node,
        overlayLabel: overlayLabel.join(" | ") || undefined,
      },
      style: isOverlay
        ? undefined
        : { opacity: 0.5, filter: "grayscale(50%)" }, // dim underlay nodes
    });
  }

  // ── EVPN L3 VNI peering edges (VTEPs sharing matching RT on a L3 VNI) ────────
  // Build: vtepId → Set of L3 VNI RT strings
  const vtepL3Rts = new Map<string, Map<number, Set<string>>>();
  for (const node of ir.topology.nodes) {
    if (!node.evpn?.vnis) continue;
    const l3VniRts = new Map<number, Set<string>>();
    for (const vni of node.evpn.vnis) {
      if (vni.type !== "L3") continue;
      const rts = new Set([...(vni.rt_import ?? []), ...(vni.rt_export ?? [])]);
      l3VniRts.set(vni.vni, rts);
    }
    if (l3VniRts.size > 0) vtepL3Rts.set(node.id, l3VniRts);
  }

  const seenL3Edges = new Set<string>();
  const vtepList = [...vtepL3Rts.keys()];
  for (let i = 0; i < vtepList.length; i++) {
    for (let j = i + 1; j < vtepList.length; j++) {
      const a = vtepList[i];
      const b = vtepList[j];
      // Find shared VNIs with matching RTs
      const aVnis = vtepL3Rts.get(a)!;
      const bVnis = vtepL3Rts.get(b)!;
      const sharedVnis: number[] = [];
      for (const [vni, aRts] of aVnis) {
        const bRts = bVnis.get(vni);
        if (!bRts) continue;
        // Check RT overlap
        for (const rt of aRts) {
          if (bRts.has(rt)) { sharedVnis.push(vni); break; }
        }
      }
      if (sharedVnis.length === 0) continue;

      const key = [a, b].sort().join("~~");
      if (seenL3Edges.has(key)) continue;
      seenL3Edges.add(key);

      edges.push({
        id: `overlay-l3vni-${key}`,
        source: a,
        target: b,
        type: "default",
        animated: true,
        label: `L3 VNI ${sharedVnis.join(",")}`,
        style: { stroke: "#06b6d4", strokeWidth: 2, strokeDasharray: "4,3" },
        labelStyle: { fontSize: 10, fill: "#0e7490" },
        labelBgStyle: { fill: "rgba(255,255,255,0.85)" },
      });
    }
  }

  // ── SRv6 adjacency: nodes sharing the same locator prefix subnet ─────────────
  const srv6Nodes = ir.topology.nodes.filter((n) => n.srv6?.locator);
  const seenSrv6Edges = new Set<string>();
  for (let i = 0; i < srv6Nodes.length; i++) {
    for (let j = i + 1; j < srv6Nodes.length; j++) {
      const a = srv6Nodes[i];
      const b = srv6Nodes[j];
      // Check if there's a physical link between them (SRv6 typically over underlay)
      const hasPhyLink = ir.topology.links.some(
        (l) =>
          (l.source.node === a.id && l.target.node === b.id) ||
          (l.source.node === b.id && l.target.node === a.id)
      );
      if (!hasPhyLink) continue;

      const key = [a.id, b.id].sort().join("~~");
      if (seenSrv6Edges.has(key)) continue;
      seenSrv6Edges.add(key);

      edges.push({
        id: `overlay-srv6-${key}`,
        source: a.id,
        target: b.id,
        type: "default",
        animated: false,
        label: `SRv6`,
        style: { stroke: "#8b5cf6", strokeWidth: 2, strokeDasharray: "6,3" },
        labelStyle: { fontSize: 10, fill: "#6d28d9" },
        labelBgStyle: { fill: "rgba(255,255,255,0.85)" },
      });
    }
  }

  // ── Physical underlay links (dimmed) ─────────────────────────────────────────
  for (const link of ir.topology.links) {
    // Skip if already covered by an overlay edge
    const key = [link.source.node, link.target.node].sort().join("~~");
    const hasOverlay =
      seenL3Edges.has(key) || seenSrv6Edges.has(key);

    edges.push({
      id: `overlay-phy-${link.id}`,
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
      style: hasOverlay
        ? { stroke: "#e2e8f0", strokeWidth: 1, opacity: 0.4 } // very dim if overlay present
        : { stroke: "#cbd5e1", strokeWidth: 1 },               // dim underlay
    });
  }

  return { nodes, edges };
}

export const overlayView: ViewDef = {
  id: "overlay",
  label: "Overlay",
  description: "EVPN VTEP tunnels and SRv6 segments",
  color: "#8b5cf6",
  needsLayout: false,
  isAvailable: (ir) => ir.topology.nodes.some((n) => n.evpn || n.srv6),
  derive,
};
