import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { ViewId } from "../lib/views";

interface ViewState {
  activeView: ViewId;
  setActiveView: (view: ViewId) => void;
}

export const useViewStore = create<ViewState>()(
  persist(
    (set) => ({
      activeView: "l1",
      setActiveView: (view) => set({ activeView: view }),
    }),
    { name: "netxray-view" }
  )
);
