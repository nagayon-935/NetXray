import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { PacketPath } from "../../engine/types";
import { type ViewDef, type ViewResult, isLinkOnPath } from "./index";
import { COLORS } from "../colors";

// One color per VNI group (cycling)
const DOMAIN_COLORS = [
  { bg: "rgba(16,185,129,0.07)",  border: "rgba(16,185,129,0.45)" },  // emerald
  { bg: "rgba(6,182,212,0.07)",   border: "rgba(6,182,212,0.45)"  },  // cyan
  { bg: "rgba(139,92,246,0.07)",  border: "rgba(139,92,246,0.45)" },  // violet
  { bg: "rgba(245,158,11,0.07)",  border: "rgba(245,158,11,0.45)" },  // amber
  { bg: "rgba(236,72,153,0.07)",  border: "rgba(236,72,153,0.45)" },  // pink
];

function domainColor(idx: number) {
  return DOMAIN_COLORS[idx % DOMAIN_COLORS.length];
}

function derive(ir: NetXrayIR, packetPath?: PacketPath | null): ViewResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const nodeMap = new Map(ir.topology.nodes.map((n) => [n.id, n]));

  // ── Step 1: collect VTEP → L2 VNI mappings ──────────────────────────────────
  const vtepVnis = new Map<string, Set<number>>();
  const vniVlans = new Map<number, Set<number>>();

  for (const node of ir.topology.nodes) {
    const l2Vnis = node.evpn?.vnis?.filter((v) => v.type === "L2") ?? [];
    if (l2Vnis.length === 0) continue;
    vtepVnis.set(node.id, new Set(l2Vnis.map((v) => v.vni)));
    for (const v of l2Vnis) {
      if (v.vlan != null) {
        if (!vniVlans.has(v.vni)) vniVlans.set(v.vni, new Set());
        vniVlans.get(v.vni)!.add(v.vlan);
      }
    }
  }

  // ── Step 2: physical adjacency (for host→VTEP mapping) ──────────────────────
  const adjacency = new Map<string, Set<string>>();
  for (const node of ir.topology.nodes) adjacency.set(node.id, new Set());
  for (const link of ir.topology.links) {
    adjacency.get(link.source.node)?.add(link.target.node);
    adjacency.get(link.target.node)?.add(link.source.node);
  }

  // ── Step 3: build L2 domains per VNI — VTEPs only ───────────────────────────
  // Hosts are NOT placed inside VNI groups because a VTEP can participate in
  // multiple VNIs and ReactFlow nodes can have only one parentId.
  // Host↔VTEP membership is conveyed by the physical access links instead.
  const domainMembers = new Map<number, Set<string>>();

  for (const [vtepId, vnis] of vtepVnis) {
    for (const vni of vnis) {
      if (!domainMembers.has(vni)) domainMembers.set(vni, new Set());
      domainMembers.get(vni)!.add(vtepId);
    }
  }

  // ── Step 4: classify nodes ───────────────────────────────────────────────────
  // VTEPs belong to VNI group boxes. Everything else (spines, hosts) is
  // top-level: spines are the IP underlay, hosts connect via access links.
  const vtepIds = new Set(vtepVnis.keys());
  const underlayNodes = ir.topology.nodes
    .filter((n) => !vtepIds.has(n.id))
    .map((n) => n.id);

  // ── Step 5: build ReactFlow nodes ────────────────────────────────────────────
  // ReactFlow nodes can have only one parentId, so each VTEP is assigned to
  // the lowest-numbered VNI group it belongs to. Empty groups are skipped.
  // VXLAN tunnel edges (step 6) carry the full per-VNI information instead.
  const assignedVteps = new Set<string>();
  let colorIdx = 0;

  for (const [vni, members] of [...domainMembers.entries()].sort(([a], [b]) => a - b)) {
    const unassigned = [...members].filter((id) => !assignedVteps.has(id));
    if (unassigned.length === 0) continue;

    const groupId = `group-vni-${vni}`;
    const vlans = vniVlans.get(vni);
    let label = `VNI ${vni}`;
    if (vlans && vlans.size > 0) label += ` · VLAN ${[...vlans].sort().join(",")}`;

    const color = domainColor(colorIdx++);
    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 0, y: 0 },
      data: { label },
      style: {
        backgroundColor: color.bg,
        border: `1.5px solid ${color.border}`,
        borderRadius: 10,
      },
    });

    for (const nodeId of unassigned) {
      const node = nodeMap.get(nodeId)!;
      assignedVteps.add(nodeId);
      nodes.push({
        id: node.id,
        type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
        parentId: groupId,
        extent: "parent",
        position: { x: 0, y: 0 },
        data: { ...node },
        style: { zIndex: 1 },
      });
    }
  }

  // 5b. Underlay / transit nodes (spines, etc.) — free-floating, no group
  for (const nodeId of underlayNodes) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;
    nodes.push({
      id: node.id,
      type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
      position: { x: 0, y: 0 },
      data: { ...node },
      // Slight dimming to hint "these are underlay/transit"
      style: { opacity: 0.85 },
    });
  }

  // ── Step 6: VTEP-to-VTEP VXLAN tunnel edges (overlay) ───────────────────────
  // Draw one tunnel edge per shared VNI between VTEPs. If multiple VNIs share
  // the same VTEP pair, they stack as separate edges.
  const seenTunnels = new Set<string>();
  for (const [vni, members] of domainMembers) {
    const vtepList = [...members].filter((id) => vtepVnis.has(id));
    for (let i = 0; i < vtepList.length; i++) {
      for (let j = i + 1; j < vtepList.length; j++) {
        const pairKey = [vtepList[i], vtepList[j]].sort().join("~~");
        const edgeKey = `${vni}~~${pairKey}`;
        if (seenTunnels.has(edgeKey)) continue;
        seenTunnels.add(edgeKey);

        edges.push({
          id: `l2-vxlan-${edgeKey}`,
          source: vtepList[i],
          target: vtepList[j],
          type: "default",
          animated: true,
          label: `VNI ${vni}`,
          style: {
            stroke: "#06b6d4",
            strokeWidth: 2.5,
            strokeDasharray: "7,3",
          },
          labelStyle: { fontSize: 10, fill: "#0e7490", fontWeight: 600 },
          labelBgStyle: { fill: "rgba(255,255,255,0.9)", borderRadius: 3 },
          labelBgPadding: [4, 2] as [number, number],
        });
      }
    }
  }

  // ── Step 7: physical links (underlay fabric + access links) ─────────────────
  // All physical links are shown so the user can see the real cable topology.
  //   • Underlay fabric links (spine↔leaf, spine↔spine): thin gray, low opacity
  //   • Access links (leaf↔host): normal weight, slightly more visible
  for (const link of ir.topology.links) {
    const srcNode = nodeMap.get(link.source.node);
    const dstNode = nodeMap.get(link.target.node);
    if (!srcNode || !dstNode) continue;

    const isAccessLink =
      srcNode.type === "host" || dstNode.type === "host";
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
            : { stroke: "#94a3b8", strokeWidth: 1, opacity: 0.35 }, // underlay fabric — very dim
    });
  }

  return { nodes, edges };
}

export const l2View: ViewDef = {
  id: "l2",
  label: "L2 / VXLAN",
  description:
    "Overlay view — VNI group boxes show L2 broadcast domains stretched between VTEPs. " +
    "Animated dashed cyan lines = VXLAN tunnels (one per shared VNI). " +
    "Dim gray lines = physical underlay fabric (spine↔leaf cables). " +
    "Spine/transit nodes float freely above the overlay groups.",
  color: "#06b6d4",
  needsLayout: true,
  isAvailable: (ir) =>
    ir.topology.nodes.some((n) => n.evpn?.vnis?.some((v) => v.type === "L2")),
  derive,
};
