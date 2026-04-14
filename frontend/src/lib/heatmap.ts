/**
 * Heatmap calculation utilities.
 */

export interface HeatmapStyle {
  stroke: string;
  strokeWidth: number;
  isBottleneck: boolean;
}

export const HEATMAP_THRESHOLDS = {
  HIGH: 0.8,
  MID: 0.4,
};

export const HEATMAP_COLORS = {
  LOW: "#10b981",  // Emerald 500
  MID: "#f59e0b",  // Amber 500
  HIGH: "#ef4444", // Red 500
};

export const HEATMAP_WIDTH = {
  MIN: 1,
  SCALE_FACTOR: 5,
};

export function getHeatmapStyle(bps: number, maxBps: number): HeatmapStyle {
  // Guard against division by zero — return "zero traffic" style
  const ratio = maxBps > 0 ? Math.min(1, bps / maxBps) : 0;
  
  let color = HEATMAP_COLORS.LOW;
  if (ratio > HEATMAP_THRESHOLDS.HIGH) {
    color = HEATMAP_COLORS.HIGH;
  } else if (ratio > HEATMAP_THRESHOLDS.MID) {
    color = HEATMAP_COLORS.MID;
  }
  
  const width = HEATMAP_WIDTH.MIN + (ratio * HEATMAP_WIDTH.SCALE_FACTOR);
  
  return {
    stroke: color,
    strokeWidth: width,
    isBottleneck: ratio > HEATMAP_THRESHOLDS.HIGH
  };
}
