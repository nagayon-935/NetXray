import { useCallback, useState } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { useViewStore } from "../../stores/view-store";
import { VIEW_DEFS, type ViewId } from "../../lib/views";
import { useLayerStore, LAYER_DEFS, type LayerId } from "../../stores/layer-store";
import { useSnapshotStore } from "../../stores/snapshot-store";
import { useWhatIfStore } from "../../stores/whatif-store";
import { useIRLoad } from "../../hooks/useIRLoad";
import type { LayoutPreset } from "../../hooks/useTopologyLayout";
import { ShareButton } from "./ShareButton";

interface SimToolbarProps {
  onLayoutChange: (preset: LayoutPreset) => void;
  onLoadSample: (name: string) => void;
}

export function SimToolbar({ onLayoutChange, onLoadSample }: SimToolbarProps) {
  const ir = useTopologyStore((s) => s.ir);
  const setActivePanel = useTopologyStore((s) => s.setActivePanel);
  const activePanel = useTopologyStore((s) => s.activePanel);
  const engineStatus = useTopologyStore((s) => s.engineStatus);

  const activeViewId = useViewStore((s) => s.activeView);
  const setActiveView = useViewStore((s) => s.setActiveView);

  const layers = useLayerStore((s) => s.layers);
  const toggleLayer = useLayerStore((s) => s.toggleLayer);

  const saveSnapshot = useSnapshotStore((s) => s.saveSnapshot);
  const snapshotCount = useSnapshotStore((s) => s.snapshots.length);

  const whatIfActive = useWhatIfStore((s) => s.isActive);
  const whatIfFailureCount = useWhatIfStore((s) => s.failures.length);
  const activateWhatIf = useWhatIfStore((s) => s.activate);
  const deactivateWhatIf = useWhatIfStore((s) => s.deactivate);

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

  const handleSaveSnapshot = useCallback(() => {
    if (!ir) return;
    saveSnapshot(ir);
    setActivePanel("snapshot");
  }, [ir, saveSnapshot, setActivePanel]);

  const handleWhatIfToggle = useCallback(() => {
    if (whatIfActive) {
      deactivateWhatIf();
      setActivePanel(null);
    } else {
      if (!ir) return;
      activateWhatIf(ir);
      setActivePanel("whatif");
    }
  }, [whatIfActive, ir, activateWhatIf, deactivateWhatIf, setActivePanel]);

  // Which views are available given the current IR
  const availableViews = VIEW_DEFS.filter((def) => {
    if (!ir) return def.id === "physical";
    return def.isAvailable(ir);
  });

  return (
    <div className="flex items-center gap-2 p-2 bg-slate-50 border-b border-slate-200 text-xs flex-wrap">
      {/* Engine status badge */}
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

      {/* Load section */}
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
            <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-slate-200 rounded shadow-lg min-w-[160px]">
              {apiTopos && apiTopos.length === 0 && (
                <div className="px-3 py-2 text-slate-400 text-xs">No topologies saved</div>
              )}
              {apiTopos?.map((t) => (
                <button
                  key={t.name}
                  onClick={() => {
                    handleApiLoad(t.name);
                    setShowApiMenu(false);
                  }}
                  className="w-full text-left px-3 py-1.5 hover:bg-slate-50 text-xs"
                >
                  <span className="font-medium">{t.name}</span>
                  <span className="text-slate-400 ml-1">({t.node_count} nodes)</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="w-px h-5 bg-slate-300" />

      {/* View section */}
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

      {/* Layers section — non-base overlays */}
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

      {/* Layout section — only for Physical view */}
      {activeViewId === "physical" && (
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

      {/* Panel section */}
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
          onClick={() => setActivePanel(activePanel === "snapshot" ? null : "snapshot")}
          className={`px-2 py-1 border rounded relative ${
            activePanel === "snapshot"
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "bg-white border-slate-200 hover:bg-slate-100"
          }`}
        >
          Snapshots
          {snapshotCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center text-[9px] bg-blue-500 text-white rounded-full leading-none">
              {snapshotCount}
            </span>
          )}
        </button>
        <button
          onClick={() => setActivePanel(activePanel === "timeline" ? null : "timeline")}
          disabled={snapshotCount === 0}
          title="Time-travel through snapshots"
          className={`px-2 py-1 border rounded disabled:opacity-40 disabled:cursor-not-allowed ${
            activePanel === "timeline"
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "bg-white border-slate-200 hover:bg-slate-100"
          }`}
        >
          Timeline
        </button>
        <button
          onClick={() => setActivePanel(activePanel === "config" ? null : "config")}
          disabled={!ir}
          className={`px-2 py-1 border rounded disabled:opacity-40 disabled:cursor-not-allowed ${
            activePanel === "config"
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "bg-white border-slate-200 hover:bg-slate-100"
          }`}
        >
          Config Gen
        </button>
        <button
          onClick={() => setActivePanel(activePanel === "diagnosis" ? null : "diagnosis")}
          disabled={!ir}
          className={`px-2 py-1 border rounded disabled:opacity-40 disabled:cursor-not-allowed ${
            activePanel === "diagnosis"
              ? "bg-blue-50 border-blue-300 text-blue-700"
              : "bg-white border-slate-200 hover:bg-slate-100"
          }`}
        >
          Diagnosis
        </button>

        {/* What-If toggle */}
        <button
          onClick={handleWhatIfToggle}
          disabled={!ir}
          className={`px-2 py-1 border rounded relative disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
            whatIfActive
              ? "bg-orange-500 border-orange-500 text-white"
              : activePanel === "whatif" || activePanel === "convergence"
              ? "bg-orange-50 border-orange-300 text-orange-700"
              : "bg-white border-slate-200 hover:bg-orange-50 hover:border-orange-300 hover:text-orange-700"
          }`}
          title={whatIfActive ? "Exit What-If mode" : "Enter What-If mode"}
        >
          What-If
          {whatIfActive && whatIfFailureCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 flex items-center justify-center text-[9px] bg-red-500 text-white rounded-full leading-none">
              {whatIfFailureCount}
            </span>
          )}
        </button>
      </div>

      {/* Lab control */}
      <div className="flex items-center gap-1">
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
        <button
          onClick={() => setActivePanel(activePanel === "capture" ? null : "capture")}
          disabled={!ir}
          className={`px-2 py-1 border rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            activePanel === "capture"
              ? "bg-violet-50 border-violet-400 text-violet-700"
              : "bg-white border-slate-200 hover:bg-slate-100"
          }`}
          title="Packet capture via tcpdump"
        >
          Capture
        </button>
        <button
          onClick={() => setActivePanel(activePanel === "yaml-editor" ? null : "yaml-editor")}
          disabled={!ir}
          className={`px-2 py-1 border rounded transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
            activePanel === "yaml-editor"
              ? "bg-teal-50 border-teal-400 text-teal-700"
              : "bg-white border-slate-200 hover:bg-slate-100"
          }`}
          title="View and deploy containerlab YAML"
        >
          YAML
        </button>
      </div>

      {/* Snapshot save shortcut */}
      <div className="flex items-center gap-1">
        <button
          onClick={handleSaveSnapshot}
          disabled={!ir}
          title="Save snapshot of current topology state"
          className="px-2 py-1 bg-white border border-slate-200 rounded hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed text-xs"
        >
          📸
        </button>
        <ShareButton />
      </div>
    </div>
  );
}
