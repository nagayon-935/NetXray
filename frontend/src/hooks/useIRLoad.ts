import { useCallback } from "react";
import { useTopologyStore } from "../stores/topology-store";
import { fetchTopologyList, loadIRFromFile, loadIRFromUrl } from "../lib/ir-loader";

export function useIRLoad(onLoad?: () => void) {
  const loadIR = useTopologyStore((s) => s.loadIR);

  const handleFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith(".json")) return;
      try {
        const ir = await loadIRFromFile(file);
        loadIR(ir);
        onLoad?.();
      } catch (err) {
        alert(`Failed to load IR: ${err instanceof Error ? err.message : err}`);
      }
    },
    [loadIR, onLoad]
  );

  const handleApiLoad = useCallback(
    async (name: string) => {
      try {
        const ir = await loadIRFromUrl(`/api/topology/${name}`);
        loadIR(ir);
        onLoad?.();
      } catch (err) {
        alert(`Failed to load topology from API: ${err instanceof Error ? err.message : err}`);
      }
    },
    [loadIR, onLoad]
  );

  return { handleFile, handleApiLoad, fetchTopologyList };
}
