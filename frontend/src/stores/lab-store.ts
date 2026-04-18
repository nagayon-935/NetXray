import { create } from "zustand";

export type LabStatus = "idle" | "deploying" | "destroying" | "redeploying" | "done" | "error";
export type RuntimeState = "running" | "stopped" | "starting" | "unknown";

interface LabState {
  status: LabStatus;
  runId: string | null;
  /** Tail-limited log lines (max 2000) */
  logs: string[];
  topologyFile: string;
  /** nodeId → runtime state from docker event stream */
  nodeStates: Record<string, RuntimeState>;

  setStatus: (s: LabStatus) => void;
  setRunId: (id: string | null) => void;
  appendLog: (line: string) => void;
  clearLogs: () => void;
  setTopologyFile: (f: string) => void;
  setNodeState: (nodeId: string, state: RuntimeState) => void;
  clearNodeStates: () => void;
}

export const useLabStore = create<LabState>((set) => ({
  status: "idle",
  runId: null,
  logs: [],
  topologyFile: "",
  nodeStates: {},

  setStatus: (status) => set({ status }),
  setRunId: (runId) => set({ runId }),
  appendLog: (line) =>
    set((s) => ({
      logs: s.logs.length >= 2000 ? [...s.logs.slice(-1999), line] : [...s.logs, line],
    })),
  clearLogs: () => set({ logs: [] }),
  setTopologyFile: (topologyFile) => set({ topologyFile }),
  setNodeState: (nodeId, state) =>
    set((s) => ({ nodeStates: { ...s.nodeStates, [nodeId]: state } })),
  clearNodeStates: () => set({ nodeStates: {} }),
}));
