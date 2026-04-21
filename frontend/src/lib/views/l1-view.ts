/**
 * l1-view.ts — Physical (L1) topology view.
 *
 * Converts IR nodes and links directly to ReactFlow elements with no grouping.
 * ELK auto-layout positions them.
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { PacketPath } from "../../engine/types";
import { type ViewDef, type ViewResult, isLinkOnPath } from "./index";
import { COLORS } from "../colors";

function irNodeToFlowNode(node: NetXrayIR["topology"]["nodes"][number]): FlowNode {
  return {
    id: node.id,
    type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
    position: { x: 0, y: 0 },
    data: { ...node },
  };
}

function irLinkToFlowEdge(
  link: NetXrayIR["topology"]["links"][number],
  packetPath?: PacketPath | null
): FlowEdge {
  const isOnPath = isLinkOnPath(link, packetPath);

  return {
    id: link.id,
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
        : undefined,
  };
}

function derive(ir: NetXrayIR, packetPath?: PacketPath | null): ViewResult {
  return {
    nodes: ir.topology.nodes.map(irNodeToFlowNode),
    edges: ir.topology.links.map((l) => irLinkToFlowEdge(l, packetPath)),
  };
}

export const l1View: ViewDef = {
  id: "l1",
  label: "L1 / Physical",
  description: "All nodes and physical links (cabling)",
  color: "#94a3b8",
  needsLayout: true,
  isAvailable: () => true,
  derive,
};
