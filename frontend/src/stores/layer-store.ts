import { create } from "zustand";

/**
 * layer-store.ts — Manage toggleable overlays that can be enabled on top of any view.
 *
 * While ViewId (view-store.ts) describes the base topology perspective (Physical, L2, etc.),
 * Layers describe additional data overlays like packet paths or real-time metrics.
 */

export type LayerId = "traffic" | "path" | "labels" | "heatmap";

export interface LayerInfo {
  id: LayerId;
  label: string;
  color: string;
  description: string;
}

export const LAYER_DEFS: LayerInfo[] = [
  { id: "traffic", label: "Traffic", color: "#10b981", description: "Real-time traffic intensity" },
  { id: "heatmap", label: "Heatmap", color: "#f59e0b", description: "Traffic heatmap visualization" },
  { id: "path", label: "Packet Path", color: "#3b82f6", description: "Currently simulated packet path" },
  { id: "labels", label: "Labels", color: "#64748b", description: "Show interface and node labels" },
];

interface LayerState {
  layers: Record<LayerId, boolean>;
  toggleLayer: (layer: LayerId) => void;
  setLayer: (layer: LayerId, visible: boolean) => void;
}

export const useLayerStore = create<LayerState>((set) => ({
  layers: {
    traffic: false,
    path: true,
    labels: false,
    heatmap: false,
  },
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setLayer: (layer, visible) =>
    set((s) => ({ layers: { ...s.layers, [layer]: visible } })),
}));
