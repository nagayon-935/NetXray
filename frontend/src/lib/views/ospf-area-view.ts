/**
 * ospf-area-view.ts — OSPF Area-grouped topology view.
 *
 * Groups nodes by OSPF area. Routers participating in multiple areas
 * (Area Border Routers / ABRs) are highlighted and placed in their primary area.
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { ViewDef, ViewResult } from "./index";
import { COLORS } from "../colors";

const AREA_COLORS = [
  { bg: "rgba(16,185,129,0.05)", border: "#bbf7d0" },
  { bg: "rgba(59,130,246,0.05)", border: "#bfdbfe" },
  { bg: "rgba(168,85,247,0.05)", border: "#e9d5ff" },
  { bg: "rgba(245,158,11,0.05)", border: "#fed7aa" },
  { bg: "rgba(236,72,153,0.05)", border: "#fbcfe8" },
];

function areaColor(idx: number) {
  return AREA_COLORS[idx % AREA_COLORS.length];
}

function primaryArea(areas: string[]): string {
  // Prefer backbone area 0 if present
  const backbone = areas.find((a) => a === "0.0.0.0" || a === "0");
  return backbone ?? areas[0];
}

function derive(ir: NetXrayIR): ViewResult {
  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];

  const nodeMap = new Map(ir.topology.nodes.map((n) => [n.id, n]));

  // Determine each node's area set; ABRs participate in 2+
  const nodeAreas = new Map<string, Set<string>>();
  for (const node of ir.topology.nodes) {
    if (!node.ospf?.interfaces?.length) continue;
    const set = new Set<string>();
    for (const iface of node.ospf.interfaces) {
      if (iface.area) set.add(iface.area);
    }
    if (set.size > 0) nodeAreas.set(node.id, set);
  }

  // Bucket by primary area
  const areaBuckets = new Map<string, string[]>();
  const noOspf: string[] = [];
  for (const node of ir.topology.nodes) {
    const areas = nodeAreas.get(node.id);
    if (!areas) {
      noOspf.push(node.id);
      continue;
    }
    const area = primaryArea([...areas]);
    const list = areaBuckets.get(area) ?? [];
    list.push(node.id);
    areaBuckets.set(area, list);
  }

  let gIdx = 0;
  for (const [area, members] of areaBuckets) {
    const groupId = `area-${area}`;
    const color = areaColor(gIdx++);
    const isBackbone = area === "0.0.0.0" || area === "0";
    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 0, y: 0 },
      data: { label: `Area ${area}${isBackbone ? " (Backbone)" : ""}` },
      style: {
        backgroundColor: color.bg,
        border: `${isBackbone ? 2 : 1.5}px solid ${color.border}`,
        borderRadius: 10,
      },
    });
    for (const id of members) {
      const node = nodeMap.get(id)!;
      const isAbr = (nodeAreas.get(id)?.size ?? 0) > 1;
      nodes.push({
        id,
        type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
        parentId: groupId,
        extent: "parent",
        position: { x: 0, y: 0 },
        data: { ...node, isAbr },
        style: isAbr
          ? { zIndex: 1, boxShadow: "0 0 0 2px #f59e0b", borderRadius: 6 }
          : { zIndex: 1 },
      });
    }
  }

  if (noOspf.length > 0) {
    const groupId = "no-ospf";
    nodes.push({
      id: groupId,
      type: "group",
      position: { x: 0, y: 0 },
      data: { label: "No OSPF" },
      style: {
        backgroundColor: "rgba(148,163,184,0.05)",
        border: "1.5px dashed #cbd5e1",
        borderRadius: 10,
      },
    });
    for (const id of noOspf) {
      const node = nodeMap.get(id)!;
      nodes.push({
        id,
        type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
        parentId: groupId,
        extent: "parent",
        position: { x: 0, y: 0 },
        data: { ...node },
        style: { zIndex: 1, opacity: 0.5 },
      });
    }
  }

  // Render physical links; classify intra-area vs inter-area for styling
  for (const link of ir.topology.links) {
    const srcAreas = nodeAreas.get(link.source.node);
    const dstAreas = nodeAreas.get(link.target.node);
    let stroke: string | undefined;
    let dash: string | undefined;
    if (srcAreas && dstAreas) {
      const shared = [...srcAreas].some((a) => dstAreas.has(a));
      stroke = shared ? COLORS.UP : "#f59e0b";
      dash = shared ? undefined : "6,3";
    }
    if (link.state === "down") {
      stroke = COLORS.DOWN;
      dash = "5,5";
    }
    edges.push({
      id: `ospf-${link.id}`,
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
      style: stroke ? { stroke, strokeWidth: 1.5, strokeDasharray: dash } : undefined,
    });
  }

  return { nodes, edges };
}

export const ospfAreaView: ViewDef = {
  id: "ospf-area",
  label: "OSPF",
  description: "OSPF Areas with ABR highlighting",
  color: "#10b981",
  needsLayout: true,
  isAvailable: (ir) => ir.topology.nodes.some((n) => n.ospf?.interfaces?.length),
  derive,
};
