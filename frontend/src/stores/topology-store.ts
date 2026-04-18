import { create } from "zustand";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR, Node, Link } from "../types/netxray-ir";
import type { PacketPath, ShadowedRule } from "../engine/types";
import { getEngine } from "../engine/wasm-engine";
import { useSnapshotStore } from "./snapshot-store";
import { applyPatch } from "../lib/ir-patch";
import { COLORS } from "../lib/colors";

export type EngineStatus = "loading" | "wasm" | "mock";

export interface TopologyState {
  ir: NetXrayIR | null;
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  nodePositions: Record<string, { x: number; y: number; width?: number; height?: number }>;
  selectedNodeId: string | null;
  selectedLinkId: string | null;
  selectedAclName: string | null;
  packetPath: PacketPath | null;
  shadowedRules: Record<string, ShadowedRule[]>;
  activePanel: "detail" | "link-detail" | "acl" | "packet" | "snapshot" | "whatif" | "convergence" | "timeline" | "config" | "diagnosis" | "lab" | "capture" | "yaml-editor" | null;
  engineStatus: EngineStatus;

  loadIR: (ir: NetXrayIR) => void;
  selectNode: (nodeId: string | null) => void;
  selectLink: (linkId: string | null) => void;
  selectAcl: (aclName: string | null) => void;
  setPacketPath: (path: PacketPath | null) => void;
  setShadowedRules: (aclName: string, rules: ShadowedRule[]) => void;
  setActivePanel: (panel: "detail" | "link-detail" | "acl" | "packet" | "snapshot" | "whatif" | "convergence" | "timeline" | "config" | "diagnosis" | "lab" | "capture" | "yaml-editor" | null) => void;
  toggleLinkState: (linkId: string) => void;
  updateFlowElements: () => void;
  setEngineStatus: (status: "wasm" | "mock") => void;
  applyPatches: (patches: any[]) => void;
  updateNodePositions: (nodes: FlowNode[]) => void;
}

function irNodeToFlowNode(node: Node): FlowNode {
  return {
    id: node.id,
    type: node.type === "host" ? "host" : node.type === "switch" ? "switch" : "router",
    position: { x: 0, y: 0 },
    data: { ...node },
  };
}

function irLinkToFlowEdge(link: Link, packetPath: PacketPath | null): FlowEdge {
  const isOnPath = packetPath?.hops.some((hop, i) => {
    if (i === 0) return false;
    const prevHop = packetPath.hops[i - 1];
    return (
      (prevHop.node_id === link.source.node && hop.node_id === link.target.node) ||
      (prevHop.node_id === link.target.node && hop.node_id === link.source.node)
    );
  });

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
      isOnPath,
    },
    style: link.state === "down" ? { stroke: COLORS.DOWN, strokeDasharray: "5,5" } : undefined,
  };
}

export const useTopologyStore = create<TopologyState>((set, get) => ({
  ir: null,
  flowNodes: [],
  flowEdges: [],
  nodePositions: {},
  selectedNodeId: null,
  selectedLinkId: null,
  selectedAclName: null,
  packetPath: null,
  shadowedRules: {},
  activePanel: null,
  engineStatus: "loading",

  loadIR: (ir) => {
    getEngine().loadTopology(ir);
    const flowNodes = ir.topology.nodes.map(irNodeToFlowNode);
    const flowEdges = ir.topology.links.map((l) => irLinkToFlowEdge(l, null));
    set({ ir, flowNodes, flowEdges, nodePositions: {}, packetPath: null, shadowedRules: {} });
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId, selectedLinkId: null, activePanel: nodeId ? "detail" : null });
  },

  selectLink: (linkId) => {
    set({ selectedLinkId: linkId, selectedNodeId: null, activePanel: linkId ? "link-detail" : null });
  },

  selectAcl: (aclName) => {
    set({ selectedAclName: aclName, activePanel: aclName ? "acl" : null });
  },

  setPacketPath: (path) => {
    set({ packetPath: path });
    get().updateFlowElements();
  },

  setShadowedRules: (aclName, rules) => {
    set((state) => ({
      shadowedRules: { ...state.shadowedRules, [aclName]: rules },
    }));
  },

  setActivePanel: (panel) => set({ activePanel: panel }),

  toggleLinkState: (linkId) => {
    const { ir } = get();
    if (!ir) return;

    // Auto-snapshot before mutating so the timeline records each toggle
    useSnapshotStore.getState().autoSnapshot(ir, `link toggled: ${linkId}`);

    const updatedLinks = ir.topology.links.map((link) =>
      link.id === linkId
        ? { ...link, state: link.state === "up" ? ("down" as const) : ("up" as const) }
        : link
    );
    const updatedIR = { ...ir, topology: { ...ir.topology, links: updatedLinks } };
    getEngine().loadTopology(updatedIR);
    set({ ir: updatedIR });
    get().updateFlowElements();
  },

  updateFlowElements: () => {
    const { ir, packetPath } = get();
    if (!ir) return;
    set({
      flowEdges: ir.topology.links.map((l) => irLinkToFlowEdge(l, packetPath)),
    });
  },

  setEngineStatus: (status) => set({ engineStatus: status }),

  applyPatches: (patches) => {
    const { ir } = get();
    if (!ir) return;

    let nextIR = { ...ir };
    for (const p of patches) {
      nextIR = applyPatch(nextIR, p);
    }
    getEngine().loadTopology(nextIR);
    set({ ir: nextIR });
    get().updateFlowElements();
  },

  updateNodePositions: (nodes) => {
    const { nodePositions } = get();
    const next = { ...nodePositions };
    nodes.forEach((n) => {
      next[n.id] = { 
        x: n.position.x, 
        y: n.position.y,
        width: n.measured?.width || (n.style?.width as number) || 180,
        height: n.measured?.height || (n.style?.height as number) || 60
      };
    });
    set({ nodePositions: next });
  },
}));
