import { useState } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { notify } from "../../stores/toast-store";
import { validateIR } from "../../lib/validate-ir";

interface EditToolbarProps {
  onAddNode: (type: "router" | "switch" | "host") => void;
}

export function EditToolbar({ onAddNode }: EditToolbarProps) {
  const editMode = useTopologyStore((s) => s.editMode);
  const setEditMode = useTopologyStore((s) => s.setEditMode);
  const ir = useTopologyStore((s) => s.ir);
  const saveIR = useTopologyStore((s) => s.saveIR);
  const applyToClab = useTopologyStore((s) => s.applyToClab);
  const newTopology = useTopologyStore((s) => s.newTopology);
  const exportIR = useTopologyStore((s) => s.exportIR);
  const undo = useTopologyStore((s) => s.undo);
  const redo = useTopologyStore((s) => s.redo);
  const canUndo = useTopologyStore((s) => s.past.length > 0);
  const canRedo = useTopologyStore((s) => s.future.length > 0);

  const [saveName, setSaveName] = useState("my-topology");
  const [saving, setSaving] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [deployRunId, setDeployRunId] = useState<string | null>(null);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveIR(saveName);
      notify("success", `Saved "${saveName}"`);
    } catch (e) {
      notify("error", `Save failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const handleNew = () => {
    if (ir && ir.topology.nodes.length > 0) {
      if (!confirm("Discard current topology and start a new one?")) return;
    }
    newTopology();
  };

  const handleExport = () => {
    const json = exportIR();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${saveName || "topology"}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Surface validation issues; return false if any blocking error exists.
  const passesValidation = (): boolean => {
    if (!ir) return false;
    const issues = validateIR(ir);
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    warnings.slice(0, 5).forEach((w) => notify("warning", w.message));
    if (errors.length > 0) {
      errors.slice(0, 5).forEach((e) => notify("error", e.message));
      notify("error", `Validation failed: ${errors.length} error(s) — fix before deploying`);
      return false;
    }
    return true;
  };

  const handleApply = async () => {
    if (!passesValidation()) return;
    setDeploying(true);
    setDeployRunId(null);
    try {
      const runId = await applyToClab(saveName);
      setDeployRunId(runId);
      notify("success", `Deploying to clab — run:${runId}`);
    } catch (e) {
      notify("error", `Deploy failed: ${e instanceof Error ? e.message : String(e)}`);
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

      <button
        onClick={handleNew}
        className="px-2 py-1 rounded font-medium border bg-white border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
        title="Start a new empty topology"
      >
        ✨ New
      </button>

      {ir && (
        <button
          onClick={handleExport}
          className="px-2 py-1 rounded font-medium border bg-white border-slate-200 text-slate-600 hover:bg-slate-100 transition-colors"
          title="Download current topology as JSON"
        >
          ⬇ Export
        </button>
      )}

      {editMode && (
        <>
          <div className="w-px h-5 bg-amber-200" />
          <button
            onClick={undo}
            disabled={!canUndo}
            className="px-2 py-1 bg-white border border-amber-300 rounded hover:bg-amber-50 text-amber-800 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Undo (Ctrl/Cmd+Z)"
          >
            ↶ Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="px-2 py-1 bg-white border border-amber-300 rounded hover:bg-amber-50 text-amber-800 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Redo (Ctrl/Cmd+Shift+Z)"
          >
            ↷ Redo
          </button>

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
