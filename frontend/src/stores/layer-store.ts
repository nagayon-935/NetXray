import { create } from "zustand";

export type LayerId = "physical" | "bgp" | "srv6" | "evpn";

export interface LayerInfo {
  id: LayerId;
  label: string;
  color: string;
  description: string;
}

export const LAYER_DEFS: LayerInfo[] = [
  { id: "physical", label: "Physical", color: "#94a3b8", description: "Physical links" },
  { id: "bgp", label: "BGP", color: "#f59e0b", description: "BGP sessions" },
  { id: "srv6", label: "SRv6", color: "#8b5cf6", description: "SRv6 segments" },
  { id: "evpn", label: "EVPN", color: "#06b6d4", description: "EVPN/VXLAN overlays" },
];

interface LayerState {
  layers: Record<LayerId, boolean>;
  toggleLayer: (layer: LayerId) => void;
  setLayer: (layer: LayerId, visible: boolean) => void;
}

export const useLayerStore = create<LayerState>((set) => ({
  layers: {
    physical: true,
    bgp: false,
    srv6: false,
    evpn: false,
  },
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setLayer: (layer, visible) =>
    set((s) => ({ layers: { ...s.layers, [layer]: visible } })),
}));
