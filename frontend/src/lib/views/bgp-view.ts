/**
 * bgp-view.ts — BGP AS-grouped topology view.
 *
 * Groups nodes by their BGP local_as. Renders eBGP sessions between ASes
 * and iBGP sessions within an AS.
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { PacketPath } from "../../engine/types";
import type { ViewDef, ViewResult } from "./index";
import { COLORS } from "../colors";

const AS_COLORS = [
  { bg: "rgba(59,130,246,0.05)", border: "#bfdbfe" },
  { bg: "rgba(16,185,129,0.05)", border: "#bbf7d0" },
  { bg: "rgba(245,158,11,0.05)", border: "#fed7aa" },
  { bg: "rgba(168,85,247,0.05)", border: "#e9d5ff" },
  { bg: "rgba(236,72,153,0.05)", border: "#fbcfe8" },
];

function asColor(idx: number) {
  return AS_COLORS[idx % AS_COLORS.length];
}

function derive(ir: NetXrayIR, _packetPath?: PacketPath | null): ViewResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const nodeAs = new Map<string, number>();
  const nodeMap = new Map(ir.topology.nodes.map((n) => [n.id, n]));

  // Bucket BGP-speaking nodes by AS
  const asBuckets = new Map<number, string[]>();
  const noBgp: string[] = [];

  for (const node of ir.topology.nodes) {
    if (node.bgp?.local_as) {
      nodeAs.set(node.id, node.bgp.local_as);
      const list = asBuckets.get(node.bgp.local_as) ?? [];
      list.push(node.id);
      asBuckets.set(node.bgp.local_as, list);
    } else {
      noBgp.push(node.id);
    }
  }

  // BGP view: always render an AS group box, even for single-router ASes.
  // (The whole point of this view is showing which AS each node belongs to.)
  let gIdx = 0;
  for (const [as, members] of asBuckets) {
    const groupId = `as-${as}`;
    const color = asColor(gIdx++);
    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 0, y: 0 },
      data: { label: `AS ${as}` },
      style: {
        backgroundColor: color.bg,
        border: `1.5px solid ${color.border}`,
        borderRadius: 10,
      },
    });
    for (const id of members) {
      const node = nodeMap.get(id)!;
      nodes.push({
        id,
        type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
        parentId: groupId,
        extent: "parent",
        position: { x: 0, y: 0 },
        data: { ...node },
        style: { zIndex: 1 },
      });
    }
  }

  // Top-level nodes: nodes without any BGP AS (hosts, unmanaged devices)
  for (const id of noBgp) {
    const node = nodeMap.get(id);
    if (!node) continue;
    nodes.push({
      id,
      type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
      position: { x: 0, y: 0 },
      data: { ...node },
      style: { opacity: 0.7 },
    });
  }

  // Physical links (shown dim, under BGP session edges)
  for (const link of ir.topology.links) {
    edges.push({
      id: `bgp-phy-${link.id}`,
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
          ? { stroke: COLORS.DOWN, strokeDasharray: "5,5", opacity: 0.4 }
          : { stroke: COLORS.NEUTRAL, strokeWidth: 1, opacity: 0.4 },
    });
  }

  // BGP sessions (both iBGP and eBGP)
  const seen = new Set<string>();
  for (const node of ir.topology.nodes) {
    if (!node.bgp?.sessions) continue;
    for (const session of node.bgp.sessions) {
      if (!session.peer_node) continue;
      const key = [node.id, session.peer_node].sort().join("~~");
      if (seen.has(key)) continue;
      seen.add(key);

      const srcAs = nodeAs.get(node.id);
      const dstAs = nodeAs.get(session.peer_node);
      const isIbgp = srcAs !== undefined && srcAs === dstAs;
      const isEstablished = session.state === "established";

      edges.push({
        id: `bgp-${key}`,
        source: node.id,
        target: session.peer_node,
        type: "bgp",
        animated: isEstablished,
        data: {
          sourceAs: srcAs,
          targetAs: dstAs,
          state: session.state,
          sourceRole: session.role ?? null,
          isIbgp,
        },
        style: {
          stroke: isEstablished ? (isIbgp ? "#3b82f6" : COLORS.UP) : COLORS.WARN,
          strokeWidth: 2,
          strokeDasharray: isIbgp ? "3,3" : isEstablished ? undefined : "8,4",
        },
      });
    }
  }

  return { nodes, edges };
}

export const bgpView: ViewDef = {
  id: "bgp",
  label: "BGP Sessions",
  description:
    "BGP session view — each router gets its own AS box (even single-router ASes). " +
    "Shows both iBGP (dashed blue, within same AS) and eBGP (solid green) sessions. " +
    "Physical links are shown dimmed. " +
    "Best for checking peering state and iBGP mesh / route-reflector topology.",
  color: "#f59e0b",
  needsLayout: true,
  isAvailable: (ir) => ir.topology.nodes.some((n) => n.bgp?.local_as),
  derive,
};
