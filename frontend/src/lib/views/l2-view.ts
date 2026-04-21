import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { PacketPath } from "../../engine/types";
import { type ViewDef, type ViewResult, isLinkOnPath } from "./index";
import { COLORS } from "../colors";

const DOMAIN_COLORS = [
  { bg: "rgba(16,185,129,0.07)",  border: "rgba(16,185,129,0.7)"  },  // emerald
  { bg: "rgba(6,182,212,0.07)",   border: "rgba(6,182,212,0.7)"   },  // cyan
  { bg: "rgba(139,92,246,0.07)",  border: "rgba(139,92,246,0.7)"  },  // violet
  { bg: "rgba(245,158,11,0.07)",  border: "rgba(245,158,11,0.7)"  },  // amber
  { bg: "rgba(236,72,153,0.07)",  border: "rgba(236,72,153,0.7)"  },  // pink
];

function domainColor(idx: number) {
  return DOMAIN_COLORS[idx % DOMAIN_COLORS.length];
}

function derive(ir: NetXrayIR, packetPath?: PacketPath | null): ViewResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const nodeMap = new Map(ir.topology.nodes.map((n) => [n.id, n]));

  // ── Step 1: build VTEP → VNI mappings ───────────────────────────────────────
  const vtepVnis = new Map<string, Set<number>>();
  const vniMeta = new Map<number, { vlans: number[]; colorIdx: number }>();
  let colorIdx = 0;

  for (const node of ir.topology.nodes) {
    const l2Vnis = node.evpn?.vnis?.filter((v) => v.type === "L2") ?? [];
    if (l2Vnis.length === 0) continue;
    vtepVnis.set(node.id, new Set(l2Vnis.map((v) => v.vni)));
    for (const v of l2Vnis) {
      if (!vniMeta.has(v.vni)) {
        vniMeta.set(v.vni, { vlans: [], colorIdx: colorIdx++ });
      }
      if (v.vlan != null) vniMeta.get(v.vni)!.vlans.push(v.vlan);
    }
  }

  // ── Step 2: VNI broadcast-domain nodes ──────────────────────────────────────
  for (const [vni, meta] of [...vniMeta.entries()].sort(([a], [b]) => a - b)) {
    const color = domainColor(meta.colorIdx);
    const vlans = [...new Set(meta.vlans)].sort((a, b) => a - b);
    nodes.push({
      id: `vni-${vni}`,
      type: "vni",
      position: { x: 0, y: 0 },
      data: { vni, vlans, color },
    });
  }

  // ── Step 3: device nodes (all free-floating, no parentId) ───────────────────
  const vtepIds = new Set(vtepVnis.keys());
  for (const node of ir.topology.nodes) {
    nodes.push({
      id: node.id,
      type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
      position: { x: 0, y: 0 },
      data: { ...node },
      style: vtepIds.has(node.id) ? undefined : { opacity: 0.85 },
    });
  }

  // ── Step 4: VTEP → VNI membership edges (one per participation) ─────────────
  for (const [vtepId, vnis] of vtepVnis) {
    for (const vni of vnis) {
      const color = domainColor(vniMeta.get(vni)!.colorIdx);
      edges.push({
        id: `l2-member-${vtepId}-vni${vni}`,
        source: vtepId,
        target: `vni-${vni}`,
        type: "default",
        animated: false,
        style: {
          stroke: color.border,
          strokeWidth: 2,
          strokeDasharray: "6,3",
          opacity: 0.85,
        },
      });
    }
  }

  // ── Step 5: physical links (underlay fabric + access links) ─────────────────
  for (const link of ir.topology.links) {
    const srcNode = nodeMap.get(link.source.node);
    const dstNode = nodeMap.get(link.target.node);
    if (!srcNode || !dstNode) continue;

    const isAccessLink = srcNode.type === "host" || dstNode.type === "host";
    const isOnPath = isLinkOnPath(link, packetPath);
    const isDown = link.state === "down";

    edges.push({
      id: `l2-phy-${link.id}`,
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
      style: isDown
        ? { stroke: COLORS.DOWN, strokeDasharray: "5,5", opacity: 0.5 }
        : isOnPath
          ? { stroke: COLORS.PATH, strokeWidth: 3 }
          : isAccessLink
            ? { stroke: COLORS.NEUTRAL, strokeWidth: 1.5, opacity: 0.75 }
            : { stroke: "#94a3b8", strokeWidth: 1, opacity: 0.35 },
    });
  }

  return { nodes, edges };
}

export const l2View: ViewDef = {
  id: "l2",
  label: "L2 / VXLAN",
  description:
    "Overlay view — VNI nodes represent L2 broadcast domains (VXLAN segments). " +
    "Dashed colored lines = VTEP membership (each leaf connects to its VNIs). " +
    "Dim gray lines = physical underlay fabric. " +
    "A VTEP can belong to multiple VNIs without layout conflicts.",
  color: "#06b6d4",
  needsLayout: true,
  preferredLayout: "force",
  isAvailable: (ir) =>
    ir.topology.nodes.some((n) => n.evpn?.vnis?.some((v) => v.type === "L2")),
  derive,
};
