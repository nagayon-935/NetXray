import { useState } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { useSnapshotStore, diffSnapshots, type Snapshot } from "../../stores/snapshot-store";

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function DiffBadges({ snap, currentIR }: { snap: Snapshot; currentIR: NonNullable<ReturnType<typeof useTopologyStore.getState>["ir"]> }) {
  const diff = diffSnapshots(snap.ir, currentIR);
  const hasChanges =
    diff.nodesAdded.length > 0 ||
    diff.nodesRemoved.length > 0 ||
    diff.linkChanges.length > 0;

  if (!hasChanges) {
    return <span className="text-[10px] text-slate-400 italic">No changes vs current</span>;
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {diff.nodesAdded.map((id) => (
        <span key={id} className="text-[9px] px-1 bg-emerald-100 text-emerald-700 rounded">
          +{id}
        </span>
      ))}
      {diff.nodesRemoved.map((id) => (
        <span key={id} className="text-[9px] px-1 bg-red-100 text-red-700 rounded">
          -{id}
        </span>
      ))}
      {diff.linkChanges.map((lc) => (
        <span key={lc.id} className="text-[9px] px-1 bg-amber-100 text-amber-700 rounded font-mono">
          {lc.id}: {lc.from}→{lc.to}
        </span>
      ))}
    </div>
  );
}

export function SnapshotPanel() {
  const ir = useTopologyStore((s) => s.ir);
  const loadIR = useTopologyStore((s) => s.loadIR);
  const setActivePanel = useTopologyStore((s) => s.setActivePanel);

  const snapshots = useSnapshotStore((s) => s.snapshots);
  const saveSnapshot = useSnapshotStore((s) => s.saveSnapshot);
  const deleteSnapshot = useSnapshotStore((s) => s.deleteSnapshot);
  const clearSnapshots = useSnapshotStore((s) => s.clearSnapshots);

  const [labelInput, setLabelInput] = useState("");

  const handleSave = () => {
    if (!ir) return;
    saveSnapshot(ir, labelInput.trim() || undefined);
    setLabelInput("");
  };

  const handleLoad = (snap: Snapshot) => {
    loadIR(snap.ir);
  };

  return (
    <div className="w-80 bg-white border-l border-slate-200 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <h2 className="font-semibold text-sm text-slate-800">Snapshots</h2>
        <button
          onClick={() => setActivePanel(null)}
          className="text-slate-400 hover:text-slate-600 text-lg leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Save section */}
      <div className="p-3 border-b border-slate-100 flex-shrink-0">
        <div className="text-xs text-slate-500 mb-2">Save current state as snapshot</div>
        <div className="flex gap-1.5">
          <input
            type="text"
            value={labelInput}
            onChange={(e) => setLabelInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="Label (optional)"
            className="flex-1 text-xs px-2 py-1 border border-slate-200 rounded focus:outline-none focus:border-blue-400"
          />
          <button
            onClick={handleSave}
            disabled={!ir}
            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
          >
            📸 Save
          </button>
        </div>
        {!ir && (
          <div className="text-[10px] text-slate-400 mt-1">Load a topology first</div>
        )}
      </div>

      {/* Snapshot list */}
      <div className="flex-1 overflow-y-auto">
        {snapshots.length === 0 ? (
          <div className="p-4 text-center text-xs text-slate-400">
            <div className="text-2xl mb-2">📂</div>
            No snapshots yet. Save the current state to start tracking.
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {[...snapshots].reverse().map((snap) => (
              <div key={snap.id} className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-xs text-slate-800 truncate">{snap.label}</div>
                    <div className="text-[10px] text-slate-400 mt-0.5">
                      {formatTimestamp(snap.timestamp)} · {snap.ir.topology.nodes.length} nodes ·{" "}
                      {snap.ir.topology.links.length} links
                    </div>
                    {ir && <DiffBadges snap={snap} currentIR={ir} />}
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleLoad(snap)}
                      className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 rounded hover:bg-blue-100"
                      title="Restore this snapshot"
                    >
                      Load
                    </button>
                    <button
                      onClick={() => deleteSnapshot(snap.id)}
                      className="text-[10px] px-1.5 py-0.5 bg-red-50 text-red-500 border border-red-200 rounded hover:bg-red-100"
                      title="Delete snapshot"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      {snapshots.length > 0 && (
        <div className="p-2 border-t border-slate-100 flex-shrink-0">
          <button
            onClick={clearSnapshots}
            className="w-full text-[10px] px-2 py-1 text-slate-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
          >
            Clear all snapshots
          </button>
        </div>
      )}
    </div>
  );
}
