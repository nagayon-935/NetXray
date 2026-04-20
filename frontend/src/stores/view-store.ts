import { create } from "zustand";
import type { ViewId } from "../lib/views";

interface ViewState {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
}

export const useViewStore = create<ViewState>((set) => ({
  activeView: "l1",
  setActiveView: (view) => set({ activeView: view }),
}));
