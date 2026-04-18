import { create } from "zustand";

export interface ImpairmentSpec {
  sourceNode: string;
  sourceInterface: string;
  targetNode: string;
  targetInterface: string;
  delay_ms: number | null;
  jitter_ms: number | null;
  loss_pct: number | null;
  rate_kbit: number | null;
  corruption_pct: number | null;
  bothDirections: boolean;
}

interface ImpairmentState {
  /** keyed by link ID */
  impairments: Record<string, ImpairmentSpec>;
  setImpairment: (linkId: string, spec: ImpairmentSpec) => void;
  clearImpairment: (linkId: string) => void;
}

export const useImpairmentStore = create<ImpairmentState>((set) => ({
  impairments: {},

  setImpairment: (linkId, spec) =>
    set((s) => ({ impairments: { ...s.impairments, [linkId]: spec } })),

  clearImpairment: (linkId) =>
    set((s) => {
      const next = { ...s.impairments };
      delete next[linkId];
      return { impairments: next };
    }),
}));
