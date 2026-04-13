import { create } from "zustand";
import { HEATMAP_THRESHOLDS } from "../lib/heatmap";

interface HeatmapState {
  enabled: boolean;
  maxBps: number; // Normalize scale based on this value
  thresholdHigh: number; // Critical threshold
  
  setEnabled: (enabled: boolean) => void;
  setMaxBps: (bps: number) => void;
}

export const useHeatmapStore = create<HeatmapState>((set) => ({
  enabled: false,
  maxBps: 1000000, // 1 Mbps default scale
  thresholdHigh: 1000000 * HEATMAP_THRESHOLDS.HIGH,
  
  setEnabled: (enabled) => set({ enabled }),
  setMaxBps: (bps) => set({ maxBps: bps, thresholdHigh: bps * HEATMAP_THRESHOLDS.HIGH }),
}));
