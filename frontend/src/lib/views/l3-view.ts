import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { PacketPath } from "../../engine/types";
import { type ViewDef, type ViewResult, isLinkOnPath } from "./index";
import { COLORS } from "../colors";

const GROUP_COLORS = [
  { bg: "rgba(239, 246, 255, 0.4)", border: "#bfdbfe" }, // blue-50/200
  { bg: "rgba(240, 253, 244, 0.4)", border: "#bbf7d0" }, // green-50/200
  { bg: "rgba(253, 244, 255, 0.4)", border: "#fbcfe8" }, // fuchsia-50/200
  { bg: "rgba(255, 247, 237, 0.4)", border: "#fed7aa" }, // orange-50/200
  { bg: "rgba(248, 250, 252, 0.4)", border: "#e2e8f0" }, // slate-50/200
];

function groupColor(idx: number) {
  return GROUP_COLORS[idx % GROUP_COLORS.length];
}

function derive(ir: NetXrayIR, packetPath?: PacketPath | null): ViewResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  // ── Step 1: Bucket nodes by L3 domains (AS or OSPF Area) ───────────────────
  const l3Buckets = new Map<string, string[]>();
  const nodeIdMap = new Map<string, NetXrayIR["topology"]["nodes"][number]>();
  const nodeAs = new Map<string, number>();

  for (const node of ir.topology.nodes) {
    nodeIdMap.set(node.id, node);
    if (node.bgp?.local_as) {
      const as = node.bgp.local_as;
      nodeAs.set(node.id, as);
      const key = `as-${as}`;
      if (!l3Buckets.has(key)) l3Buckets.set(key, []);
      l3Buckets.get(key)!.push(node.id);
    } else if (node.ospf?.interfaces && node.ospf.interfaces.length > 0) {
      // Pick the first area (often 0 if present)
      const area = node.ospf.interfaces.find(i => i.area === "0.0.0.0" || i.area === "0")?.area 
        ?? node.ospf.interfaces[0].area;
      const key = `ospf-${area}`;
      if (!l3Buckets.has(key)) l3Buckets.set(key, []);
      l3Buckets.get(key)!.push(node.id);
    }
    // Unmanaged nodes are intentionally NOT bucketed — they stay top-level.
  }

  // ── Step 2: create group + child nodes (groups require >= 2 members) ───────
  const ungrouped = new Set<string>();
  const groupEntries = [...l3Buckets.entries()];

  groupEntries.forEach(([key, members], gIdx) => {
    if (members.length < 2) {
      members.forEach((id) => ungrouped.add(id));
      return;
    }
    const groupId = `group-${key}`;
    const color = groupColor(gIdx);
    let label = key;
    if (key.startsWith("as-")) label = `AS ${key.replace("as-", "")}`;
    else if (key.startsWith("ospf-")) label = `OSPF Area ${key.replace("ospf-", "")}`;

    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 0, y: 0 },
      data: { label, color },
      style: {
        backgroundColor: color.bg,
        border: `1.5px solid ${color.border}`,
        borderRadius: 10,
      },
    });

    members.forEach((nodeId) => {
      const node = nodeIdMap.get(nodeId)!;
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
  });

  // Top-level nodes: unmanaged (never bucketed) + single-member-bucket promotions
  for (const node of ir.topology.nodes) {
    const inBucket = [...l3Buckets.values()].some((arr) => arr.includes(node.id));
    if (!inBucket || ungrouped.has(node.id)) {
      nodes.push({
        id: node.id,
        type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
        position: { x: 0, y: 0 },
        data: { ...node },
      });
    }
  }

  // ── Step 3: eBGP edges (cross-AS BGP sessions) ───────────────────────────────
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
          stroke: isEstablished ? COLORS.UP : COLORS.WARN,
          strokeWidth: 2,
          strokeDasharray: isEstablished ? undefined : "8,4",
        },
      });
    }
  }

  // ── Step 4: physical links ─────────────────────────────────────────
  for (const link of ir.topology.links) {
    const isOnPath = isLinkOnPath(link, packetPath);

    edges.push({
      id: `l3-phy-${link.id}`,
      source: link.source.node,
      target: link.target.node,
      type: "network",
      animated: isOnPath,
      data: {
        state: link.state,
        sourceInterface: link.source.interface,
        targetInterface: link.target.interface,
        isOnPath,
      },
      style:
        link.state === "down"
          ? { stroke: COLORS.DOWN, strokeDasharray: "5,5" }
          : isOnPath
          ? { stroke: COLORS.PATH, strokeWidth: 3 }
          : { stroke: COLORS.NEUTRAL, strokeWidth: 1.5 },
    });
  }

  return { nodes, edges };
}

export const l3View: ViewDef = {
  id: "l3",
  label: "L3",
  description: "L3 topology (BGP AS / OSPF Areas)",
  color: "#f59e0b",
  needsLayout: true,
  isAvailable: (ir) => ir.topology.nodes.some((n) => n.bgp || n.ospf),
  derive,
};
