import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Node as FlowNode } from "@xyflow/react";
import type { NetXrayIR, Node, Link } from "../types/netxray-ir";
import type { PacketPath, ShadowedRule } from "../engine/types";
import { getEngine } from "../engine/wasm-engine";

export type EngineStatus = "loading" | "wasm" | "mock";

export type PanelId = "detail" | "link-detail" | "acl" | "packet" | "lab" | "edit";

export interface TopologyState {
  ir: NetXrayIR | null;
  nodePositions: Record<string, { x: number; y: number; width?: number; height?: number }>;
  selectedNodeId: string | null;
  selectedLinkId: string | null;
  selectedAclName: string | null;
  packetPath: PacketPath | null;
  shadowedRules: Record<string, ShadowedRule[]>;
  // Panel dock: multiple panels can stay open as tabs; activeTab is the one in front.
  openTabs: PanelId[];
  activeTab: PanelId | null;
  dockWidth: number;
  dockCollapsed: boolean;
  engineStatus: EngineStatus;
  editMode: boolean;
  // Undo/redo history of IR snapshots (not persisted)
  past: NetXrayIR[];
  future: NetXrayIR[];

  loadIR: (ir: NetXrayIR) => void;
  selectNode: (nodeId: string | null) => void;
  selectLink: (linkId: string | null) => void;
  selectAcl: (aclName: string | null) => void;
  setPacketPath: (path: PacketPath | null) => void;
  setShadowedRules: (aclName: string, rules: ShadowedRule[]) => void;
  openPanel: (panel: PanelId) => void;
  closePanelTab: (panel: PanelId) => void;
  toggleTab: (panel: PanelId) => void;
  setDockWidth: (width: number) => void;
  toggleDockCollapsed: () => void;
  toggleLinkState: (linkId: string) => void;
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
  /** Connect two nodes, auto-allocating a free (or new) interface on each. */
  connectNodes: (sourceNodeId: string, targetNodeId: string) => void;
  deleteLink: (linkId: string) => void;
  undo: () => void;
  redo: () => void;
  saveIR: (name: string) => Promise<void>;
  applyToClab: (topoName: string) => Promise<string>;

  // New topology / export
  newTopology: () => void;
  exportIR: () => string;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

const HISTORY_LIMIT = 50;

export const useTopologyStore = create<TopologyState>()(
  persist(
    (set, get) => {
  // Apply an IR mutation while recording the previous IR for undo.
  const commitIR = (nextIR: NetXrayIR, extra?: Partial<TopologyState>) => {
    const { ir, past } = get();
    const nextPast = ir ? [...past, ir].slice(-HISTORY_LIMIT) : past;
    getEngine().loadTopology(nextIR);
    set({ ir: nextIR, past: nextPast, future: [], ...extra });
  };

  return {
  ir: null,
  nodePositions: {},
  selectedNodeId: null,
  selectedLinkId: null,
  selectedAclName: null,
  packetPath: null,
  shadowedRules: {},
  openTabs: [],
  activeTab: null,
  dockWidth: 360,
  dockCollapsed: false,
  engineStatus: "loading",
  editMode: false,
  past: [],
  future: [],

  loadIR: (ir) => {
    getEngine().loadTopology(ir);
    const savedPositions = ir.meta?.positions ?? {};
    const nodePositions: TopologyState["nodePositions"] = {};
    for (const [id, pos] of Object.entries(savedPositions)) {
      nodePositions[id] = { x: pos.x, y: pos.y };
    }
    set({ ir, nodePositions, packetPath: null, shadowedRules: {}, past: [], future: [] });
  },

  selectNode: (nodeId) => {
    const { editMode } = get();
    set({ selectedNodeId: nodeId, selectedLinkId: null });
    if (nodeId) {
      get().openPanel(editMode ? "edit" : "detail");
    } else {
      get().closePanelTab("detail");
      get().closePanelTab("edit");
    }
  },

  selectLink: (linkId) => {
    set({ selectedLinkId: linkId, selectedNodeId: null });
    if (linkId) get().openPanel("link-detail");
    else get().closePanelTab("link-detail");
  },

  selectAcl: (aclName) => {
    set({ selectedAclName: aclName });
    if (aclName) get().openPanel("acl");
  },

  // Views derive their edges from (ir, packetPath) in TopologyCanvas, so a
  // single set() here is all that is needed to repaint the path highlight.
  setPacketPath: (path) => set({ packetPath: path }),

  setShadowedRules: (aclName, rules) => {
    set((state) => ({
      shadowedRules: { ...state.shadowedRules, [aclName]: rules },
    }));
  },

  openPanel: (panel) => {
    const { openTabs } = get();
    set({
      openTabs: openTabs.includes(panel) ? openTabs : [...openTabs, panel],
      activeTab: panel,
      dockCollapsed: false,
    });
  },

  closePanelTab: (panel) => {
    const { openTabs, activeTab } = get();
    if (!openTabs.includes(panel)) return;
    const nextTabs = openTabs.filter((p) => p !== panel);
    set({
      openTabs: nextTabs,
      activeTab: activeTab === panel ? nextTabs[nextTabs.length - 1] ?? null : activeTab,
    });
  },

  toggleTab: (panel) => {
    const { openTabs, activeTab } = get();
    if (openTabs.includes(panel) && activeTab === panel) {
      get().closePanelTab(panel);
    } else {
      get().openPanel(panel);
    }
  },

  setDockWidth: (width) => set({ dockWidth: width }),

  toggleDockCollapsed: () => set((s) => ({ dockCollapsed: !s.dockCollapsed })),

  toggleLinkState: (linkId) => {
    const { ir } = get();
    if (!ir) return;

    const updatedLinks = ir.topology.links.map((link) =>
      link.id === linkId
        ? { ...link, state: link.state === "up" ? ("down" as const) : ("up" as const) }
        : link
    );
    const updatedIR = { ...ir, topology: { ...ir.topology, links: updatedLinks } };
    commitIR(updatedIR);
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
    commitIR(updatedIR);
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
    if (!on) get().closePanelTab("edit");
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

    commitIR(updatedIR, {
      nodePositions: { ...get().nodePositions, [id]: { x: position.x, y: position.y } },
    });
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
    const { nodePositions } = get();
    const nextPos = { ...nodePositions };
    delete nextPos[nodeId];
    commitIR(updatedIR, { nodePositions: nextPos, selectedNodeId: null });
    get().closePanelTab("detail");
    get().closePanelTab("edit");
  },

  updateNode: (nodeId, patch) => {
    const { ir } = get();
    if (!ir) return;
    const updatedNodes = ir.topology.nodes.map((n) =>
      n.id === nodeId ? { ...n, ...patch } : n
    );
    const updatedIR = { ...ir, topology: { ...ir.topology, nodes: updatedNodes } };
    commitIR(updatedIR);
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
    commitIR(updatedIR);
  },

  connectNodes: (sourceNodeId, targetNodeId) => {
    const { ir } = get();
    if (!ir) return;
    const src = ir.topology.nodes.find((n) => n.id === sourceNodeId);
    const tgt = ir.topology.nodes.find((n) => n.id === targetNodeId);
    if (!src || !tgt) return;

    // Interfaces already consumed by an existing link, per node.
    const usedByNode = (nodeId: string): Set<string> => {
      const used = new Set<string>();
      for (const l of ir.topology.links) {
        if (l.source.node === nodeId) used.add(l.source.interface);
        if (l.target.node === nodeId) used.add(l.target.interface);
      }
      return used;
    };

    // Pick a free existing interface, else generate the next free ethN.
    const allocIface = (node: Node): { name: string; isNew: boolean } => {
      const ifaces = node.interfaces ?? {};
      const used = usedByNode(node.id);
      const free = Object.keys(ifaces).find((name) => !used.has(name));
      if (free) return { name: free, isNew: false };
      let i = 0;
      while (ifaces[`eth${i}`]) i++;
      return { name: `eth${i}`, isNew: true };
    };

    const srcAlloc = allocIface(src);
    const tgtAlloc = allocIface(tgt);

    // Materialize any newly-generated interfaces on their nodes.
    const updatedNodes = ir.topology.nodes.map((n) => {
      if (n.id === src.id && srcAlloc.isNew) {
        return { ...n, interfaces: { ...(n.interfaces ?? {}), [srcAlloc.name]: { state: "up" as const } } };
      }
      if (n.id === tgt.id && tgtAlloc.isNew) {
        return { ...n, interfaces: { ...(n.interfaces ?? {}), [tgtAlloc.name]: { state: "up" as const } } };
      }
      return n;
    });

    const newLink: Link = {
      id: makeId("link"),
      source: { node: src.id, interface: srcAlloc.name },
      target: { node: tgt.id, interface: tgtAlloc.name },
      state: "up",
    };
    const updatedIR = {
      ...ir,
      topology: { nodes: updatedNodes, links: [...ir.topology.links, newLink] },
    };
    commitIR(updatedIR);
  },

  deleteLink: (linkId) => {
    const { ir } = get();
    if (!ir) return;
    const updatedLinks = ir.topology.links.filter((l) => l.id !== linkId);
    const updatedIR = { ...ir, topology: { ...ir.topology, links: updatedLinks } };
    commitIR(updatedIR, { selectedLinkId: null });
    get().closePanelTab("link-detail");
  },

  undo: () => {
    const { past, future, ir } = get();
    if (past.length === 0) return;
    const previous = past[past.length - 1];
    getEngine().loadTopology(previous);
    set({
      ir: previous,
      past: past.slice(0, -1),
      future: ir ? [ir, ...future].slice(0, HISTORY_LIMIT) : future,
      selectedNodeId: null,
      selectedLinkId: null,
    });
  },

  redo: () => {
    const { past, future, ir } = get();
    if (future.length === 0) return;
    const next = future[0];
    getEngine().loadTopology(next);
    set({
      ir: next,
      past: ir ? [...past, ir].slice(-HISTORY_LIMIT) : past,
      future: future.slice(1),
      selectedNodeId: null,
      selectedLinkId: null,
    });
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
      nodePositions: {},
      packetPath: null,
      shadowedRules: {},
      selectedNodeId: null,
      selectedLinkId: null,
      openTabs: [],
      activeTab: null,
      editMode: true,
      past: [],
      future: [],
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
  };
    },
    {
      name: "netxray-topology",
      version: 1,
      // Persist only durable state — not transient selection/derived data.
      partialize: (s) => ({
        ir: s.ir,
        nodePositions: s.nodePositions,
        editMode: s.editMode,
        dockWidth: s.dockWidth,
        dockCollapsed: s.dockCollapsed,
      }),
      // Re-sync the simulation engine with the rehydrated topology.
      onRehydrateStorage: () => (state) => {
        if (state?.ir) getEngine().loadTopology(state.ir);
      },
    }
  )
);
