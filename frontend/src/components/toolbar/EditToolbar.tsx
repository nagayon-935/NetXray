import { useState } from "react";
import { useTopologyStore } from "../../stores/topology-store";

interface EditToolbarProps {
  onAddNode: (type: "router" | "switch" | "host") => void;
}

export function EditToolbar({ onAddNode }: EditToolbarProps) {
  const editMode = useTopologyStore((s) => s.editMode);
  const setEditMode = useTopologyStore((s) => s.setEditMode);
  const ir = useTopologyStore((s) => s.ir);
  const saveIR = useTopologyStore((s) => s.saveIR);
  const applyToClab = useTopologyStore((s) => s.applyToClab);

  const [saveName, setSaveName] = useState("my-topology");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [deployRunId, setDeployRunId] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await saveIR(saveName);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleApply = async () => {
    setDeploying(true);
    setDeployError(null);
    setDeployRunId(null);
    try {
      const runId = await applyToClab(saveName);
      setDeployRunId(runId);
    } catch (e) {
      setDeployError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeploying(false);
    }
  };

  return (
    <div
      className={`flex items-center gap-2 px-2 py-1.5 text-xs border-b flex-wrap transition-colors ${
        editMode
          ? "bg-amber-50 border-amber-200"
          : "bg-slate-50 border-slate-200"
      }`}
    >
      <button
        onClick={() => setEditMode(!editMode)}
        className={`px-2 py-1 rounded font-medium border transition-colors ${
          editMode
            ? "bg-amber-500 border-amber-500 text-white"
            : "bg-white border-slate-200 text-slate-600 hover:bg-slate-100"
        }`}
      >
        {editMode ? "✎ Editing" : "✎ Edit"}
      </button>

      {editMode && (
        <>
          <div className="w-px h-5 bg-amber-200" />
          <span className="text-amber-700 font-medium">Add:</span>
          {(["router", "switch", "host"] as const).map((t) => (
            <button
              key={t}
              onClick={() => onAddNode(t)}
              className="px-2 py-1 bg-white border border-amber-300 rounded hover:bg-amber-50 text-amber-800"
            >
              {t}
            </button>
          ))}

          <div className="w-px h-5 bg-amber-200" />

          {ir && (
            <>
              <input
                type="text"
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                className="text-[10px] font-mono px-2 py-1 border border-amber-300 rounded w-32 focus:outline-none focus:ring-1 focus:ring-amber-400"
                placeholder="topology-name"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-2 py-1 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white rounded border border-blue-500 transition-colors"
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                onClick={handleApply}
                disabled={deploying}
                className="px-2 py-1 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-white rounded border border-emerald-500 transition-colors"
              >
                {deploying ? "Deploying…" : "Apply to clab"}
              </button>
            </>
          )}

          {saveError && (
            <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
              {saveError}
            </span>
          )}
          {deployError && (
            <span className="text-[10px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded border border-red-200">
              {deployError}
            </span>
          )}
          {deployRunId && (
            <span className="text-[10px] text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
              Deploying run:{deployRunId}
            </span>
          )}
        </>
      )}
    </div>
  );
}
