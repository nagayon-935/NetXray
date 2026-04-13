import { create } from "zustand";
import type { NetXrayIR } from "../types/netxray-ir";

const MAX_SNAPSHOTS = 20;

export interface Snapshot {
  id: string;
  label: string;
  timestamp: number;
  /** Short description of what triggered this snapshot (e.g. "link toggled", "what-if"). */
  trigger?: string;
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
  /** Index of the snapshot currently being viewed (-1 = live / no snapshot selected). */
  currentIndex: number;
  currentSnapshotId: string | null;

  saveSnapshot: (ir: NetXrayIR, label?: string) => string;
  setSnapshots: (snapshots: Snapshot[]) => void;
  /**
   * Save an automatically-labelled snapshot.
   * @param ir       The IR to capture.
   * @param trigger  Short description shown in the timeline (e.g. "link toggled").
   */
  autoSnapshot: (ir: NetXrayIR, trigger: string) => string;
  deleteSnapshot: (id: string) => void;
  clearSnapshots: () => void;

  /** Navigate to the snapshot at index `i` and return its IR. */
  restoreByIndex: (i: number) => NetXrayIR | null;
  /** Navigate forward (+1) or backward (-1) relative to currentIndex. */
  stepIndex: (delta: number) => NetXrayIR | null;
  /** Return to live view (-1). */
  exitRestore: () => void;
}

export const useSnapshotStore = create<SnapshotState>((set, get) => ({
  snapshots: [],
  currentIndex: -1,
  currentSnapshotId: null,

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
      ir: JSON.parse(JSON.stringify(ir)) as NetXrayIR,
    };
    set((s) => ({
      snapshots: [...s.snapshots, snapshot].slice(-MAX_SNAPSHOTS),
    }));
    return id;
  },

  setSnapshots: (snapshots) => set({ snapshots, currentIndex: -1, currentSnapshotId: null }),

  autoSnapshot: (ir, trigger) => {
    const id = crypto.randomUUID();
    const ts = Date.now();
    const timeLabel = new Date(ts).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const snapshot: Snapshot = {
      id,
      label: `${timeLabel} — ${trigger}`,
      timestamp: ts,
      trigger,
      ir: JSON.parse(JSON.stringify(ir)) as NetXrayIR,
    };
    set((s) => ({
      snapshots: [...s.snapshots, snapshot].slice(-MAX_SNAPSHOTS),
    }));
    return id;
  },

  deleteSnapshot: (id) =>
    set((s) => ({
      snapshots: s.snapshots.filter((snap) => snap.id !== id),
      currentIndex: -1,
      currentSnapshotId: null,
    })),

  clearSnapshots: () => set({ snapshots: [], currentIndex: -1, currentSnapshotId: null }),

  restoreByIndex: (i) => {
    const { snapshots } = get();
    if (i < 0 || i >= snapshots.length) return null;
    set({ currentIndex: i, currentSnapshotId: snapshots[i].id });
    return snapshots[i].ir;
  },

  stepIndex: (delta) => {
    const { snapshots, currentIndex } = get();
    if (snapshots.length === 0) return null;
    const next = Math.max(0, Math.min(snapshots.length - 1, currentIndex + delta));
    if (next === currentIndex) return null;
    set({ currentIndex: next, currentSnapshotId: snapshots[next].id });
    return snapshots[next].ir;
  },

  exitRestore: () => set({ currentIndex: -1, currentSnapshotId: null }),
}));
