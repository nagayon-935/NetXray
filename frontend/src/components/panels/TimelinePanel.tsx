/**
 * TimelinePanel — Horizontal snapshot timeline with playback controls.
 *
 * Shows all saved snapshots as marker buttons on a slider.
 * Supports manual scrubbing, step-through, and auto-play in both directions.
 * When a snapshot is selected the topology canvas restores that IR.
 */

import { useCallback } from "react";
import { useSnapshotStore } from "../../stores/snapshot-store";
import { useTopologyStore } from "../../stores/topology-store";
import { useTimeline } from "../../hooks/useTimeline";
import { diffSnapshots } from "../../stores/snapshot-store";

export function TimelinePanel() {
  const { snapshots, deleteSnapshot, clearSnapshots } = useSnapshotStore();
  const loadIR = useTopologyStore((s) => s.loadIR);

  // When restoring, re-load the IR into the topology store
  const handleRestore = useCallback(
    (ir: Parameters<typeof loadIR>[0]) => {
      loadIR(ir);
    },
    [loadIR]
  );

  const {
    currentIndex,
    isPlaying,
    seekTo,
    stepForward,
    stepBackward,
    exitRestore,
    play,
    pause,
    setIntervalMs,
    intervalMs,
  } = useTimeline(handleRestore);

  const isRestoring = currentIndex >= 0;

  if (snapshots.length === 0) {
    return (
      <div className="w-80 bg-white border-l border-slate-200 p-4 space-y-2 text-sm text-slate-400">
        <p>No snapshots yet.</p>
        <p className="text-xs">
          Snapshots are saved automatically when you toggle link states, or manually via the
          camera button in the toolbar.
        </p>
      </div>
    );
  }

  const currentSnap = currentIndex >= 0 ? snapshots[currentIndex] : null;
  const prevSnap = currentIndex > 0 ? snapshots[currentIndex - 1] : null;
  const diff = currentSnap && prevSnap ? diffSnapshots(prevSnap.ir, currentSnap.ir) : null;

  return (
    <div className="w-80 bg-white border-l border-slate-200 flex flex-col h-full text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b border-slate-200">
        <span className="font-semibold text-slate-700">
          Timeline
          <span className="ml-1.5 text-slate-400 font-normal">
            ({snapshots.length} snapshot{snapshots.length !== 1 ? "s" : ""})
          </span>
        </span>
        {snapshots.length > 0 && (
          <button
            onClick={() => {
              if (confirm("Delete all snapshots?")) {
                exitRestore();
                clearSnapshots();
              }
            }}
            className="text-slate-400 hover:text-red-500 text-[10px]"
          >
            Clear all
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Live / Restore indicator */}
        {isRestoring ? (
          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span className="text-amber-700 font-medium">
                Viewing snapshot {currentIndex + 1} / {snapshots.length}
              </span>
            </div>
            <button
              onClick={exitRestore}
              className="text-amber-500 hover:text-amber-700 text-[10px]"
            >
              ✕ Back to live
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 text-emerald-600 text-[11px]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Live view
          </div>
        )}

        {/* Slider */}
        <div>
          <input
            type="range"
            min={0}
            max={snapshots.length - 1}
            value={Math.max(0, currentIndex)}
            onChange={(e) => seekTo(Number(e.target.value))}
            className="w-full accent-slate-500"
          />
          <div className="flex justify-between text-[9px] text-slate-400 mt-0.5">
            <span>{new Date(snapshots[0].timestamp).toLocaleTimeString()}</span>
            <span>
              {new Date(snapshots[snapshots.length - 1].timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => seekTo(0)}
            disabled={currentIndex === 0}
            className="p-1.5 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Jump to first"
          >
            ⏮
          </button>
          <button
            onClick={stepBackward}
            disabled={currentIndex <= 0}
            className="p-1.5 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Previous"
          >
            ◀
          </button>
          <button
            onClick={isPlaying ? pause : () => play("forward")}
            className={`px-3 py-1.5 rounded font-medium text-sm ${
              isPlaying
                ? "bg-slate-200 hover:bg-slate-300 text-slate-700"
                : "bg-slate-700 hover:bg-slate-800 text-white"
            }`}
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            onClick={stepForward}
            disabled={currentIndex >= snapshots.length - 1}
            className="p-1.5 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Next"
          >
            ▶
          </button>
          <button
            onClick={() => seekTo(snapshots.length - 1)}
            disabled={currentIndex >= snapshots.length - 1}
            className="p-1.5 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Jump to last"
          >
            ⏭
          </button>
        </div>

        {/* Speed selector */}
        <div className="flex items-center justify-center gap-2 text-[10px] text-slate-500">
          <span>Speed:</span>
          {[2000, 1000, 500, 250].map((ms) => (
            <button
              key={ms}
              onClick={() => setIntervalMs(ms)}
              className={`px-2 py-0.5 rounded border ${
                intervalMs === ms
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-white border-slate-200 hover:bg-slate-50"
              }`}
            >
              {ms >= 1000 ? `${ms / 1000}s` : `${ms}ms`}
            </button>
          ))}
        </div>

        {/* Diff with previous snapshot */}
        {diff && (currentSnap || prevSnap) && (
          <div className="bg-slate-50 border border-slate-200 rounded p-2 space-y-1">
            <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
              Changes from previous snapshot
            </p>
            {diff.nodesAdded.length > 0 && (
              <p className="text-emerald-600">
                + Nodes: {diff.nodesAdded.join(", ")}
              </p>
            )}
            {diff.nodesRemoved.length > 0 && (
              <p className="text-red-500">
                - Nodes: {diff.nodesRemoved.join(", ")}
              </p>
            )}
            {diff.linkChanges.map((c) => (
              <p key={c.id} className="text-orange-600">
                Link {c.id}: {c.from} → {c.to}
              </p>
            ))}
            {diff.nodesAdded.length === 0 &&
              diff.nodesRemoved.length === 0 &&
              diff.linkChanges.length === 0 && (
                <p className="text-slate-400 italic">No structural changes</p>
              )}
          </div>
        )}

        {/* Snapshot list */}
        <div>
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">
            Snapshots
          </p>
          <div className="space-y-0.5 max-h-56 overflow-y-auto">
            {snapshots.map((snap, i) => (
              <div
                key={snap.id}
                className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-colors ${
                  i === currentIndex
                    ? "bg-slate-700 text-white"
                    : "bg-white border border-slate-100 hover:bg-slate-50"
                }`}
                onClick={() => seekTo(i)}
              >
                <span
                  className={`text-[10px] font-mono flex-shrink-0 ${
                    i === currentIndex ? "text-slate-300" : "text-slate-400"
                  }`}
                >
                  #{i + 1}
                </span>
                <span className="flex-1 truncate text-[11px]">{snap.label}</span>
                {snap.trigger && (
                  <span
                    className={`text-[9px] px-1 rounded flex-shrink-0 ${
                      i === currentIndex
                        ? "bg-slate-600 text-slate-200"
                        : "bg-slate-100 text-slate-400"
                    }`}
                  >
                    {snap.trigger}
                  </span>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (i === currentIndex) exitRestore();
                    deleteSnapshot(snap.id);
                  }}
                  className={`flex-shrink-0 hover:text-red-400 ${
                    i === currentIndex ? "text-slate-400" : "text-slate-300"
                  }`}
                  title="Delete snapshot"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
