import { create } from "zustand";
import type { Node as FlowNode, Edge as FlowEdge } from "@xyflow/react";
import type { NetXrayIR, Node, Link } from "../types/netxray-ir";
import type { PacketPath, ShadowedRule } from "../engine/types";
import { getEngine } from "../engine/wasm-engine";
import { COLORS } from "../lib/colors";

export type EngineStatus = "loading" | "wasm" | "mock";

export type ActivePanel =
  | "detail"
  | "link-detail"
  | "acl"
  | "packet"
  | "lab"
  | "edit"
  | null;

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
  activePanel: ActivePanel;
  engineStatus: EngineStatus;
  editMode: boolean;

  loadIR: (ir: NetXrayIR) => void;
  selectNode: (nodeId: string | null) => void;
  selectLink: (linkId: string | null) => void;
  selectAcl: (aclName: string | null) => void;
  setPacketPath: (path: PacketPath | null) => void;
  setShadowedRules: (aclName: string, rules: ShadowedRule[]) => void;
  setActivePanel: (panel: ActivePanel) => void;
  toggleLinkState: (linkId: string) => void;
  updateFlowElements: () => void;
  setEngineStatus: (status: "wasm" | "mock") => void;
  updateNodePositions: (nodes: FlowNode[]) => void;
  updateInterface: (
    nodeId: string,
    ifaceName: string,
    patch: Partial<{ ip: string; mac: string }>
  ) => void;

  // Edit mode
  setEditMode: (on: boolean) => void;
  addNode: (type: "router" | "switch" | "host", position: { x: number; y: number }) => string;
  deleteNode: (nodeId: string) => void;
  updateNode: (nodeId: string, patch: Partial<Node>) => void;
  addLink: (
    sourceNode: string,
    sourceInterface: string,
    targetNode: string,
    targetInterface: string
  ) => void;
  deleteLink: (linkId: string) => void;
  saveIR: (name: string) => Promise<void>;
  applyToClab: (topoName: string) => Promise<string>;

  // New topology / export
  newTopology: () => void;
  exportIR: () => string;
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

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
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
  editMode: false,

  loadIR: (ir) => {
    getEngine().loadTopology(ir);
    const flowNodes = ir.topology.nodes.map(irNodeToFlowNode);
    const flowEdges = ir.topology.links.map((l) => irLinkToFlowEdge(l, null));
    const savedPositions = ir.meta?.positions ?? {};
    const nodePositions: TopologyState["nodePositions"] = {};
    for (const [id, pos] of Object.entries(savedPositions)) {
      nodePositions[id] = { x: pos.x, y: pos.y };
    }
    set({ ir, flowNodes, flowEdges, nodePositions, packetPath: null, shadowedRules: {} });
  },

  selectNode: (nodeId) => {
    const { editMode } = get();
    set({
      selectedNodeId: nodeId,
      selectedLinkId: null,
      activePanel: nodeId ? (editMode ? "edit" : "detail") : null,
    });
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

  updateInterface: (nodeId, ifaceName, patch) => {
    const { ir } = get();
    if (!ir) return;
    const updatedNodes = ir.topology.nodes.map((n) => {
      if (n.id !== nodeId) return n;
      const iface = n.interfaces?.[ifaceName];
      if (!iface) return n;
      return {
        ...n,
        interfaces: {
          ...n.interfaces,
          [ifaceName]: { ...iface, ...patch },
        },
      };
    });
    const updatedIR = { ...ir, topology: { ...ir.topology, nodes: updatedNodes } };
    getEngine().loadTopology(updatedIR);
    set({ ir: updatedIR });
  },

  updateNodePositions: (nodes) => {
    const { nodePositions } = get();
    const next = { ...nodePositions };
    nodes.forEach((n) => {
      next[n.id] = {
        x: n.position.x,
        y: n.position.y,
        width: n.measured?.width || (n.style?.width as number) || 180,
        height: n.measured?.height || (n.style?.height as number) || 60,
      };
    });
    set({ nodePositions: next });
  },

  // ── Edit mode ────────────────────────────────────────────────────────────────

  setEditMode: (on) => {
    set({ editMode: on });
    if (!on) {
      // Leaving edit mode: close edit panel
      const { activePanel } = get();
      if (activePanel === "edit") set({ activePanel: null });
    }
  },

  addNode: (type, position) => {
    const { ir } = get();
    const id = makeId(type);
    const newNode: Node = {
      id,
      type,
      vendor: "generic",
      interfaces: {
        eth0: { state: "up" },
      },
    };

    const updatedIR: NetXrayIR = ir
      ? { ...ir, topology: { ...ir.topology, nodes: [...ir.topology.nodes, newNode] } }
      : {
          ir_version: "0.2.0",
          topology: { nodes: [newNode], links: [] },
        };

    getEngine().loadTopology(updatedIR);
    set({ ir: updatedIR, nodePositions: { ...get().nodePositions, [id]: { x: position.x, y: position.y } } });
    return id;
  },

  deleteNode: (nodeId) => {
    const { ir } = get();
    if (!ir) return;
    const updatedNodes = ir.topology.nodes.filter((n) => n.id !== nodeId);
    const updatedLinks = ir.topology.links.filter(
      (l) => l.source.node !== nodeId && l.target.node !== nodeId
    );
    const updatedIR = { ...ir, topology: { nodes: updatedNodes, links: updatedLinks } };
    getEngine().loadTopology(updatedIR);
    const { nodePositions } = get();
    const nextPos = { ...nodePositions };
    delete nextPos[nodeId];
    set({ ir: updatedIR, nodePositions: nextPos, selectedNodeId: null, activePanel: null });
  },

  updateNode: (nodeId, patch) => {
    const { ir } = get();
    if (!ir) return;
    const updatedNodes = ir.topology.nodes.map((n) =>
      n.id === nodeId ? { ...n, ...patch } : n
    );
    const updatedIR = { ...ir, topology: { ...ir.topology, nodes: updatedNodes } };
    getEngine().loadTopology(updatedIR);
    set({ ir: updatedIR });
  },

  addLink: (sourceNode, sourceInterface, targetNode, targetInterface) => {
    const { ir } = get();
    if (!ir) return;
    const id = makeId("link");
    const newLink: Link = {
      id,
      source: { node: sourceNode, interface: sourceInterface },
      target: { node: targetNode, interface: targetInterface },
      state: "up",
    };
    const updatedIR = {
      ...ir,
      topology: { ...ir.topology, links: [...ir.topology.links, newLink] },
    };
    getEngine().loadTopology(updatedIR);
    set({ ir: updatedIR });
  },

  deleteLink: (linkId) => {
    const { ir } = get();
    if (!ir) return;
    const updatedLinks = ir.topology.links.filter((l) => l.id !== linkId);
    const updatedIR = { ...ir, topology: { ...ir.topology, links: updatedLinks } };
    getEngine().loadTopology(updatedIR);
    set({ ir: updatedIR, selectedLinkId: null, activePanel: null });
  },

  saveIR: async (name) => {
    const { ir, nodePositions } = get();
    if (!ir) throw new Error("No topology loaded");
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of Object.entries(nodePositions)) {
      positions[id] = { x: p.x, y: p.y };
    }
    const irWithMeta = {
      ...ir,
      meta: { ...(ir.meta ?? {}), positions },
    };
    const res = await fetch(`/api/topology/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(irWithMeta),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? `HTTP ${res.status}`);
    }
  },

  newTopology: () => {
    const emptyIR: NetXrayIR = {
      ir_version: "0.2.0",
      topology: { nodes: [], links: [] },
      meta: { positions: {} },
    };
    getEngine().loadTopology(emptyIR);
    set({
      ir: emptyIR,
      flowNodes: [],
      flowEdges: [],
      nodePositions: {},
      packetPath: null,
      shadowedRules: {},
      selectedNodeId: null,
      selectedLinkId: null,
      activePanel: null,
      editMode: true,
    });
  },

  exportIR: () => {
    const { ir, nodePositions } = get();
    if (!ir) throw new Error("No topology loaded");
    const positions: Record<string, { x: number; y: number }> = {};
    for (const [id, p] of Object.entries(nodePositions)) {
      positions[id] = { x: p.x, y: p.y };
    }
    const irWithMeta = {
      ...ir,
      meta: { ...(ir.meta ?? {}), positions },
    };
    return JSON.stringify(irWithMeta, null, 2);
  },

  applyToClab: async (topoName) => {
    const { ir } = get();
    if (!ir) throw new Error("No topology loaded");

    const res = await fetch("/api/iac/clone-to-clab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ir, topo_name: topoName }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.detail ?? `HTTP ${res.status}`);
    }
    const { run_id } = await res.json();
    return run_id as string;
  },
}));
