import { useCallback } from "react";
import { useTopologyStore } from "../stores/topology-store";
import { fetchTopologyList, loadIRFromFile, loadIRFromUrl } from "../lib/ir-loader";

export function useIRLoad(onLoad?: () => void) {
  const loadIR = useTopologyStore((s) => s.loadIR);

  const handleFile = useCallback(
    async (file: File) => {
      const lower = file.name.toLowerCase();
      const isYaml =
        lower.endsWith(".clab.yml") ||
        lower.endsWith(".clab.yaml") ||
        lower.endsWith(".yml") ||
        lower.endsWith(".yaml");
      const isJson = lower.endsWith(".json");

      if (!isJson && !isYaml) {
        alert("Unsupported file type. Use .json or .clab.yml / .yaml.");
        return;
      }

      try {
        if (isJson) {
          const ir = await loadIRFromFile(file);
          loadIR(ir);
        } else {
          const text = await file.text();
          const res = await fetch("/api/iac/from-clab-yaml", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ yaml_text: text, filename: file.name }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.detail ?? `HTTP ${res.status}`);
          }
          const ir = await res.json();
          loadIR(ir);
        }
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
