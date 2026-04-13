import { create } from "zustand";
import type { NetXrayIR } from "../types/netxray-ir";

const MAX_SNAPSHOTS = 20;

export interface Snapshot {
  id: string;
  label: string;
  timestamp: number;
  ir: NetXrayIR;
}

export interface SnapshotDiff {
  nodesAdded: string[];
  nodesRemoved: string[];
  linkChanges: { id: string; from: string; to: string }[];
}

/** Deep-compare two IRs and return a human-readable diff summary. */
export function diffSnapshots(base: NetXrayIR, current: NetXrayIR): SnapshotDiff {
  const baseNodeIds = new Set(base.topology.nodes.map((n) => n.id));
  const currentNodeIds = new Set(current.topology.nodes.map((n) => n.id));

  const nodesAdded = [...currentNodeIds].filter((id) => !baseNodeIds.has(id));
  const nodesRemoved = [...baseNodeIds].filter((id) => !currentNodeIds.has(id));

  const baseLinkMap = new Map(base.topology.links.map((l) => [l.id, l.state]));
  const linkChanges: { id: string; from: string; to: string }[] = [];

  for (const link of current.topology.links) {
    const baseState = baseLinkMap.get(link.id);
    if (baseState && baseState !== link.state) {
      linkChanges.push({ id: link.id, from: baseState, to: link.state });
    }
  }

  return { nodesAdded, nodesRemoved, linkChanges };
}

interface SnapshotState {
  snapshots: Snapshot[];
  saveSnapshot: (ir: NetXrayIR, label?: string) => string;
  deleteSnapshot: (id: string) => void;
  clearSnapshots: () => void;
}

export const useSnapshotStore = create<SnapshotState>((set) => ({
  snapshots: [],

  saveSnapshot: (ir, label) => {
    const id = crypto.randomUUID();
    const ts = Date.now();
    const defaultLabel = new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const snapshot: Snapshot = {
      id,
      label: label ?? defaultLabel,
      timestamp: ts,
      ir: JSON.parse(JSON.stringify(ir)) as NetXrayIR, // deep clone
    };
    // Keep only the most recent MAX_SNAPSHOTS snapshots to cap memory usage
    set((s) => ({ snapshots: [...s.snapshots, snapshot].slice(-MAX_SNAPSHOTS) }));
    return id;
  },

  deleteSnapshot: (id) =>
    set((s) => ({ snapshots: s.snapshots.filter((snap) => snap.id !== id) })),

  clearSnapshots: () => set({ snapshots: [] }),
}));
