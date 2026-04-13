/**
 * physical-view.ts — Default physical topology view.
 *
 * Converts IR nodes and links directly to ReactFlow elements with no grouping.
 * Positions are left at (0,0) — the ELK layout pass in TopologyCanvas
 * places them correctly (needsLayout: true).
 */

import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR } from "../../types/netxray-ir";
import type { ViewDef, ViewResult } from "./index";

function irNodeToFlowNode(node: NetXrayIR["topology"]["nodes"][number]): FlowNode {
  return {
    id: node.id,
    type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
    position: { x: 0, y: 0 },
    data: { ...node },
  };
}

function irLinkToFlowEdge(link: NetXrayIR["topology"]["links"][number]): FlowEdge {
  return {
    id: link.id,
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
    style: link.state === "down" ? { stroke: "#ef4444", strokeDasharray: "5,5" } : undefined,
  };
}

function derive(ir: NetXrayIR): ViewResult {
  return {
    nodes: ir.topology.nodes.map(irNodeToFlowNode),
    edges: ir.topology.links.map(irLinkToFlowEdge),
  };
}

export const physicalView: ViewDef = {
  id: "physical",
  label: "Physical",
  description: "All nodes and physical links",
  color: "#94a3b8",
  needsLayout: true,
  isAvailable: () => true,
  derive,
};
