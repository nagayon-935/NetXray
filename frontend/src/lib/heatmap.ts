/**
 * Heatmap calculation utilities.
 */

import { COLORS } from "./colors";

export interface HeatmapStyle {
  stroke: string;
  strokeWidth: number;
  isBottleneck: boolean;
}

export const HEATMAP_THRESHOLDS = {
  HIGH: 0.8,
  MID: 0.4,
};

export const HEATMAP_WIDTH = {
  MIN: 1,
  SCALE_FACTOR: 5,
};

export function getHeatmapStyle(bps: number, maxBps: number): HeatmapStyle {
  // Guard against division by zero — return "zero traffic" style
  const ratio = maxBps > 0 ? Math.min(1, bps / maxBps) : 0;

  let color: string = COLORS.UP;
  if (ratio > HEATMAP_THRESHOLDS.HIGH) {
    color = COLORS.DOWN;
  } else if (ratio > HEATMAP_THRESHOLDS.MID) {
    color = COLORS.WARN;
  }
  
  const width = HEATMAP_WIDTH.MIN + (ratio * HEATMAP_WIDTH.SCALE_FACTOR);
  
  return {
    stroke: color,
    strokeWidth: width,
    isBottleneck: ratio > HEATMAP_THRESHOLDS.HIGH
  };
}
