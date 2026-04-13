/**
 * whatif-store.ts — Zustand store for What-If analysis sessions.
 *
 * Lifecycle:
 *  1. User opens the What-If panel → `activate(currentIR)` freezes a baseline copy.
 *  2. User adds / removes failures (links or nodes) via `addFailure` / `removeFailure`.
 *  3. `runSimulation()` calls the engine and stores results.
 *  4. Optionally `runConvergence()` computes tick-by-tick convergence.
 *  5. `computeAlternatePaths(src, dst)` finds paths around the failures.
 *  6. `deactivate()` clears everything and returns to normal view.
 */

import { create } from "zustand";
import type { NetXrayIR } from "../types/netxray-ir";
import type {
  FailureSpec,
  RoutingUpdate,
  PacketPath,
  ConvergenceStep,
} from "../engine/types";
import { getEngine } from "../engine/wasm-engine";

// ── State shape ──────────────────────────────────────────────────────────────

export interface WhatIfState {
  /** True when the What-If mode is active. */
  isActive: boolean;

  /**
   * The IR snapshot taken when `activate()` was called.
   * Simulation results are always compared against this baseline.
   */
  baseIR: NetXrayIR | null;

  /** Currently selected failure scenarios (order matters for display). */
  failures: FailureSpec[];

  /** Routing update produced by the most recent `runSimulation()` call. */
  routingUpdate: RoutingUpdate | null;

  /** Node IDs affected by the current failures (array for safe Zustand equality). */
  affectedNodes: string[];

  /** Convergence steps produced by `runConvergence()`. Empty until called. */
  convergenceSteps: ConvergenceStep[];

  /**
   * Alternate paths produced by `computeAlternatePaths()`.
   * Empty until that method is explicitly called.
   */
  alternatePaths: PacketPath[];

  /** Whether a simulation is currently running (for loading UI). */
  isSimulating: boolean;

  // ── Actions ──────────────────────────────────────────────────────────────

  /**
   * Enter What-If mode, freezing `ir` as the baseline.
   * Resets all previous results.
   */
  activate: (ir: NetXrayIR) => void;

  /** Exit What-If mode and reset all state. */
  deactivate: () => void;

  /** Add a failure to the scenario. No-op if already present. */
  addFailure: (spec: FailureSpec) => void;

  /** Remove a failure from the scenario. */
  removeFailure: (spec: FailureSpec) => void;

  /** Remove all failures. */
  clearFailures: () => void;

  /**
   * Run multi-failure simulation against the engine.
   * Populates `routingUpdate` and `affectedNodes`.
   */
  runSimulation: () => void;

  /**
   * Run convergence simulation.
   * Populates `convergenceSteps`.
   */
  runConvergence: () => void;

  /**
   * Compute alternate paths between two nodes under current failures.
   * Populates `alternatePaths`.
   */
  computeAlternatePaths: (srcNodeId: string, dstNodeId: string) => void;
}

// ── Initial / reset state ────────────────────────────────────────────────────

const RESET: Pick<
  WhatIfState,
  | "isActive"
  | "baseIR"
  | "failures"
  | "routingUpdate"
  | "affectedNodes"
  | "convergenceSteps"
  | "alternatePaths"
  | "isSimulating"
> = {
  isActive: false,
  baseIR: null,
  failures: [],
  routingUpdate: null,
  affectedNodes: [],
  convergenceSteps: [],
  alternatePaths: [],
  isSimulating: false,
};

// ── Store ────────────────────────────────────────────────────────────────────

export const useWhatIfStore = create<WhatIfState>((set, get) => ({
  ...RESET,

  activate: (ir) => {
    // Deep-clone the IR so mutations to the live topology don't bleed in.
    const baseIR = JSON.parse(JSON.stringify(ir)) as NetXrayIR;
    set({ ...RESET, isActive: true, baseIR });
  },

  deactivate: () => {
    set({ ...RESET });
  },

  addFailure: (spec) => {
    const { failures } = get();
    // Prevent duplicates
    const alreadyPresent = failures.some(
      (f) => f.kind === spec.kind && f.id === spec.id
    );
    if (alreadyPresent) return;
    set({ failures: [...failures, spec] });
  },

  removeFailure: (spec) => {
    set((s) => ({
      failures: s.failures.filter((f) => !(f.kind === spec.kind && f.id === spec.id)),
    }));
  },

  clearFailures: () => {
    set({ failures: [], routingUpdate: null, affectedNodes: [], convergenceSteps: [], alternatePaths: [] });
  },

  runSimulation: () => {
    const { failures, baseIR } = get();
    if (!baseIR || failures.length === 0) {
      set({ routingUpdate: null, affectedNodes: [] });
      return;
    }

    set({ isSimulating: true });
    try {
      // Load the baseline into the engine for simulation
      const engine = getEngine();
      engine.loadTopology(baseIR);

      const update = engine.simulateMultiFailure(failures);
      const affectedNodes = update.affected_nodes;

      set({ routingUpdate: update, affectedNodes, isSimulating: false });
    } catch (err) {
      console.error("[WhatIf] runSimulation failed:", err);
      set({ isSimulating: false });
    }
  },

  runConvergence: () => {
    const { failures, baseIR } = get();
    if (!baseIR || failures.length === 0) {
      set({ convergenceSteps: [] });
      return;
    }

    set({ isSimulating: true });
    try {
      const engine = getEngine();
      engine.loadTopology(baseIR);

      const steps = engine.simulateConvergence(failures);
      set({ convergenceSteps: steps, isSimulating: false });
    } catch (err) {
      console.error("[WhatIf] runConvergence failed:", err);
      set({ isSimulating: false });
    }
  },

  computeAlternatePaths: (srcNodeId, dstNodeId) => {
    const { failures, baseIR } = get();
    if (!baseIR) {
      set({ alternatePaths: [] });
      return;
    }

    set({ isSimulating: true });
    try {
      const engine = getEngine();
      engine.loadTopology(baseIR);

      const paths = engine.computeAlternatePaths(srcNodeId, dstNodeId, failures);
      set({ alternatePaths: paths, isSimulating: false });
    } catch (err) {
      console.error("[WhatIf] computeAlternatePaths failed:", err);
      set({ isSimulating: false });
    }
  },
}));
