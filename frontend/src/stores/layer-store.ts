import { create } from "zustand";
import { COLORS } from "../lib/colors";

/**
 * layer-store.ts — Toggleable overlays on top of any view.
 */

export type LayerId = "path" | "labels";

export interface LayerInfo {
  id: LayerId;
  label: string;
  color: string;
  description: string;
}

export const LAYER_DEFS: LayerInfo[] = [
  { id: "path", label: "Packet Path", color: COLORS.PATH, description: "Currently simulated packet path" },
  { id: "labels", label: "Labels", color: "#64748b", description: "Show interface and node labels" },
];

interface LayerState {
  layers: Record<LayerId, boolean>;
  toggleLayer: (layer: LayerId) => void;
  setLayer: (layer: LayerId, visible: boolean) => void;
}

export const useLayerStore = create<LayerState>((set) => ({
  layers: {
    path: true,
    labels: false,
  },
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setLayer: (layer, visible) =>
    set((s) => ({ layers: { ...s.layers, [layer]: visible } })),
}));
