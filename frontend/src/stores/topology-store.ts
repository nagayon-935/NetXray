import { create } from "zustand";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR, Node, Link } from "../types/netxray-ir";
import type { PacketPath, ShadowedRule } from "../engine/types";
import { getEngine } from "../engine/wasm-engine";
import { useSnapshotStore } from "./snapshot-store";
import { applyPatch } from "../lib/ir-patch";

export type EngineStatus = "loading" | "wasm" | "mock";

export interface TopologyState {
  ir: NetXrayIR | null;
  flowNodes: FlowNode[];
  flowEdges: FlowEdge[];
  selectedNodeId: string | null;
  selectedAclName: string | null;
  packetPath: PacketPath | null;
  shadowedRules: Record<string, ShadowedRule[]>;
  activePanel: "detail" | "acl" | "packet" | "snapshot" | "whatif" | "convergence" | "timeline" | "config" | "diagnosis" | null;
  engineStatus: EngineStatus;

  loadIR: (ir: NetXrayIR) => void;
  selectNode: (nodeId: string | null) => void;
  selectAcl: (aclName: string | null) => void;
  setPacketPath: (path: PacketPath | null) => void;
  setShadowedRules: (aclName: string, rules: ShadowedRule[]) => void;
  setActivePanel: (panel: "detail" | "acl" | "packet" | "snapshot" | "whatif" | "convergence" | "timeline" | "config" | "diagnosis" | null) => void;
  toggleLinkState: (linkId: string) => void;
  updateFlowElements: () => void;
  setEngineStatus: (status: "wasm" | "mock") => void;
  applyPatches: (patches: any[]) => void;
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
    animated: isOnPath ?? false,
    data: {
      state: link.state,
      sourceNode: link.source.node,
      sourceInterface: link.source.interface,
      targetNode: link.target.node,
      targetInterface: link.target.interface,
      isOnPath: isOnPath ?? false,
    },
    style: link.state === "down" ? { stroke: "#ef4444", strokeDasharray: "5,5" } : undefined,
  };
}

export const useTopologyStore = create<TopologyState>((set, get) => ({
  ir: null,
  flowNodes: [],
  flowEdges: [],
  selectedNodeId: null,
  selectedAclName: null,
  packetPath: null,
  shadowedRules: {},
  activePanel: null,
  engineStatus: "loading",

  loadIR: (ir) => {
    getEngine().loadTopology(ir);
    const flowNodes = ir.topology.nodes.map(irNodeToFlowNode);
    const flowEdges = ir.topology.links.map((l) => irLinkToFlowEdge(l, null));
    set({ ir, flowNodes, flowEdges, packetPath: null, shadowedRules: {} });
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId, activePanel: nodeId ? "detail" : null });
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
    const flowEdges = ir.topology.links.map((l) => irLinkToFlowEdge(l, packetPath));
    set({ flowEdges });
  },

  setEngineStatus: (status) => set({ engineStatus: status }),

  applyPatches: (patches) => {
    const { ir } = get();
    if (!ir) return;
    const updatedIR = applyPatch(ir, patches);
    set({ ir: updatedIR });
    // After patching telemetry, we might need to re-generate flow elements if heatmap is active
    get().updateFlowElements();
  },
}));
