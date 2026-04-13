import { useEffect } from "react";
import { useTopologyStore, type EngineStatus } from "../stores/topology-store";
import { loadWasmEngine, getEngine } from "../engine/wasm-engine";

export type { EngineStatus };

export function useWasmEngine(): { status: EngineStatus } {
  // Read-only subscription: only the status string causes re-renders
  const status = useTopologyStore((s) => s.engineStatus);

  useEffect(() => {
    let cancelled = false;
    loadWasmEngine().then((wasmEng) => {
      if (cancelled) return;
      // Sync any IR already loaded before WASM finished
      const ir = useTopologyStore.getState().ir;
      if (wasmEng && ir) getEngine().loadTopology(ir);
      // Write via getState() — avoids a second hook subscription that changes
      // Zustand's internal hook strategy and violates Rules of Hooks
      useTopologyStore.getState().setEngineStatus(wasmEng ? "wasm" : "mock");
    });
    return () => {
      cancelled = true;
    };
  }, []); // intentionally empty — init runs exactly once

  return { status };
}
