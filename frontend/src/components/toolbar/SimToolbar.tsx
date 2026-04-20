import { useCallback, useState } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { useViewStore } from "../../stores/view-store";
import { VIEW_DEFS, type ViewId } from "../../lib/views";
import { useLayerStore, LAYER_DEFS, type LayerId } from "../../stores/layer-store";
import { useIRLoad } from "../../hooks/useIRLoad";
import type { LayoutPreset } from "../../hooks/useTopologyLayout";

interface SimToolbarProps {
  onLayoutChange: (preset: LayoutPreset) => void;
  onLoadSample: (name: string) => void;
}

export function SimToolbar({ onLayoutChange, onLoadSample }: SimToolbarProps) {
  const ir = useTopologyStore((s) => s.ir);
  const loadIR = useTopologyStore((s) => s.loadIR);
  const setActivePanel = useTopologyStore((s) => s.setActivePanel);
  const activePanel = useTopologyStore((s) => s.activePanel);
  const engineStatus = useTopologyStore((s) => s.engineStatus);

  const activeViewId = useViewStore((s) => s.activeView);
  const setActiveView = useViewStore((s) => s.setActiveView);

  const layers = useLayerStore((s) => s.layers);
  const toggleLayer = useLayerStore((s) => s.toggleLayer);

  const { handleFile, handleApiLoad, fetchTopologyList } = useIRLoad();
  const [apiTopos, setApiTopos] = useState<{ name: string; node_count: number }[] | null>(null);
  const [showApiMenu, setShowApiMenu] = useState(false);

  const handleFileUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await handleFile(file);
      e.target.value = "";
    },
    [handleFile]
  );

  const handleApiButtonClick = useCallback(async () => {
    if (showApiMenu) {
      setShowApiMenu(false);
      return;
    }
    try {
      const list = await fetchTopologyList();
      setApiTopos(list);
      setShowApiMenu(true);
    } catch {
      alert("Cannot reach API server. Is the backend running on port 8000?");
    }
  }, [showApiMenu, fetchTopologyList]);

  const availableViews = VIEW_DEFS.filter((def) => {
    if (!ir) return def.id === "l1";
    return def.isAvailable(ir);
  });

  return (
    <div className="flex items-center gap-2 p-2 bg-slate-50 border-b border-slate-200 text-xs flex-wrap">
      <span
        title={`Engine: ${engineStatus}`}
        className={`px-1.5 py-0.5 rounded font-mono text-[10px] flex-shrink-0 ${
          engineStatus === "wasm"
            ? "bg-emerald-100 text-emerald-700"
            : engineStatus === "mock"
            ? "bg-amber-100 text-amber-700"
            : "bg-slate-100 text-slate-400"
        }`}
      >
        {engineStatus === "wasm" ? "WASM" : engineStatus === "mock" ? "mock" : "..."}
      </span>

      <div className="flex items-center gap-1">
        <span className="text-slate-500 font-medium">Load:</span>
        <button
          onClick={() => onLoadSample("simple-3node")}
          className="px-2 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100"
        >
          3-Node
        </button>
        <button
          onClick={() => onLoadSample("spine-leaf-4")}
          className="px-2 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100"
        >
          Spine-Leaf
        </button>
        <label className="px-2 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 cursor-pointer">
          File...
          <input type="file" accept=".json" className="hidden" onChange={handleFileUpload} />
        </label>
        <div className="relative">
          <button
            onClick={handleApiButtonClick}
            className={`px-2 py-1 border rounded ${
              showApiMenu
                ? "bg-blue-50 border-blue-300 text-blue-700"
                : "bg-white border-slate-200 hover:bg-slate-100"
            }`}
          >
            API...
          </button>
          {showApiMenu && (
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded shadow-lg min-w-[240px] p-1">
              <div className="px-3 py-2 text-[10px] text-slate-400 uppercase font-bold border-b border-slate-100 mb-1">
                Saved Topologies
              </div>
              <div className="max-h-48 overflow-y-auto">
                {apiTopos && apiTopos.length === 0 && (
                  <div className="px-3 py-2 text-slate-400 text-xs italic">No saved topologies</div>
                )}
                {apiTopos?.map((t) => (
                  <button
                    key={t.name}
                    onClick={() => {
                      handleApiLoad(t.name);
                      setShowApiMenu(false);
                    }}
                    className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-xs rounded"
                  >
                    <span className="font-medium text-slate-700">{t.name}</span>
                    <span className="text-slate-400 ml-1">({t.node_count} nodes)</span>
                  </button>
                ))}
              </div>

              <div className="border-t border-slate-100 mt-1 pt-1 p-2 space-y-2">
                <div className="text-[10px] text-slate-400 uppercase font-bold mb-1">
                  Scan Running Lab
                </div>
                <input
                  type="text"
                  placeholder="/labs/your-lab.clab.yml"
                  className="w-full text-[10px] font-mono px-2 py-1 border rounded"
                  id="clab-path-input"
                  onClick={(e) => e.stopPropagation()}
                  defaultValue="/labs/frr.clab.yml"
                />
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const input = document.getElementById("clab-path-input") as HTMLInputElement;
                    const path = input.value;
                    if (!path) return;
                    try {
                      const res = await fetch("/api/collect", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          topology_name: "collected-lab",
                          clab_topology: path,
                        }),
                      });
                      if (!res.ok) throw new Error("Failed");
                      const ir = await res.json();
                      loadIR(ir);
                      setShowApiMenu(false);
                    } catch {
                      alert("Scan failed. Check if path is correct and lab is running.");
                    }
                  }}
                  className="w-full bg-blue-500 text-white text-[10px] font-bold py-1 rounded hover:bg-blue-600"
                >
                  SCAN &amp; LOAD
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="w-px h-5 bg-slate-300" />

      <div className="flex items-center gap-1">
        <span className="text-slate-500 font-medium">View:</span>
        {availableViews.map((def) => (
          <button
            key={def.id}
            onClick={() => setActiveView(def.id as ViewId)}
            title={def.description}
            className={`px-2 py-1 border rounded transition-colors ${
              activeViewId === def.id
                ? "text-white"
                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-100"
            }`}
            style={
              activeViewId === def.id
                ? { backgroundColor: def.color, borderColor: def.color }
                : undefined
            }
          >
            {def.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-slate-300" />

      <div className="flex items-center gap-1">
        <span className="text-slate-500 font-medium">Layers:</span>
        {LAYER_DEFS.map((def) => (
          <button
            key={def.id}
            onClick={() => toggleLayer(def.id as LayerId)}
            title={def.description}
            className={`px-2 py-1 border rounded transition-colors ${
              layers[def.id as LayerId]
                ? "text-white"
                : "bg-white border-slate-200 text-slate-500 hover:bg-slate-100"
            }`}
            style={
              layers[def.id as LayerId]
                ? { backgroundColor: def.color, borderColor: def.color }
                : undefined
            }
          >
            {def.label}
          </button>
        ))}
      </div>

      <div className="w-px h-5 bg-slate-300" />

      {activeViewId === "l1" && (
        <>
          <div className="flex items-center gap-1">
            <span className="text-slate-500 font-medium">Layout:</span>
            {(["spine-leaf", "layered", "force"] as LayoutPreset[]).map((preset) => (
              <button
                key={preset}
                onClick={() => onLayoutChange(preset)}
                className="px-2 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100"
              >
                {preset}
              </button>
            ))}
          </div>
          <div className="w-px h-5 bg-slate-300" />
        </>
      )}

      <div className="flex items-center gap-1">
        <span className="text-slate-500 font-medium">Panel:</span>
        <button
          onClick={() => setActivePanel(activePanel === "acl" ? null : "acl")}
          className={`px-2 py-1 border rounded ${
            activePanel === "acl"
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "bg-white border-slate-200 hover:bg-slate-100"
          }`}
        >
          ACL
        </button>
        <button
          onClick={() => setActivePanel(activePanel === "packet" ? null : "packet")}
          className={`px-2 py-1 border rounded ${
            activePanel === "packet"
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "bg-white border-slate-200 hover:bg-slate-100"
          }`}
        >
          Packet Sim
        </button>
        <button
          onClick={() => setActivePanel(activePanel === "lab" ? null : "lab")}
          className={`px-2 py-1 border rounded transition-colors ${
            activePanel === "lab"
              ? "bg-emerald-50 border-emerald-400 text-emerald-700"
              : "bg-white border-slate-200 hover:bg-slate-100"
          }`}
          title="Deploy / destroy containerlab topologies"
        >
          Lab
        </button>
      </div>
    </div>
  );
}
