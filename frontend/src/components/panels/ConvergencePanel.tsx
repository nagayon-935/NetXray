/**
 * ConvergencePanel — Step-by-step routing convergence visualiser.
 *
 * Shows each discrete tick produced by `simulateConvergence()`:
 *  - Which nodes updated their routing tables
 *  - Which nodes have stabilised
 *  - Overall stable ratio as a progress bar
 *
 * Supports manual step-through and auto-play.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useWhatIfStore } from "../../stores/whatif-store";
import { useTopologyStore } from "../../stores/topology-store";

export function ConvergencePanel() {
  const { convergenceSteps, failures, runConvergence, isSimulating } = useWhatIfStore();
  const setActivePanel = useTopologyStore((s) => s.setActivePanel);

  const [currentTick, setCurrentTick] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const playIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalTicks = convergenceSteps.length;
  const step = convergenceSteps[currentTick];

  // ── Auto-play ────────────────────────────────────────────────────────────────

  const stopPlay = useCallback(() => {
    if (playIntervalRef.current !== null) {
      clearInterval(playIntervalRef.current);
      playIntervalRef.current = null;
    }
    setIsPlaying(false);
  }, []);

  const startPlay = useCallback(() => {
    if (totalTicks === 0) return;
    stopPlay(); // always clear any existing interval before creating a new one
    setIsPlaying(true);
    playIntervalRef.current = setInterval(() => {
      setCurrentTick((t) => {
        if (t >= totalTicks - 1) {
          stopPlay();
          return t;
        }
        return t + 1;
      });
    }, 700);
  }, [totalTicks, stopPlay]);

  // Cleanup on unmount
  useEffect(() => () => stopPlay(), [stopPlay]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleRerun = useCallback(() => {
    stopPlay();
    setCurrentTick(0);
    runConvergence();
  }, [runConvergence, stopPlay]);

  const handleBack = useCallback(() => {
    stopPlay();
    setActivePanel("whatif");
  }, [stopPlay, setActivePanel]);

  const handleStepBack = useCallback(() => {
    stopPlay();
    setCurrentTick((t) => Math.max(0, t - 1));
  }, [stopPlay]);

  const handleStepForward = useCallback(() => {
    stopPlay();
    setCurrentTick((t) => Math.min(totalTicks - 1, t + 1));
  }, [totalTicks, stopPlay]);

  const handleRewind = useCallback(() => {
    stopPlay();
    setCurrentTick(0);
  }, [stopPlay]);

  // ── Empty state ──────────────────────────────────────────────────────────────

  if (failures.length === 0) {
    return (
      <div className="w-80 bg-white border-l border-slate-200 p-4 space-y-3 text-xs">
        <button onClick={handleBack} className="text-blue-500 hover:text-blue-700">
          ← Back to What-If
        </button>
        <p className="text-slate-400">No failures defined. Go back and add failures first.</p>
      </div>
    );
  }

  if (totalTicks === 0 && !isSimulating) {
    return (
      <div className="w-80 bg-white border-l border-slate-200 p-4 space-y-3 text-xs">
        <button onClick={handleBack} className="text-blue-500 hover:text-blue-700">
          ← Back to What-If
        </button>
        <p className="text-slate-500 mb-2">No convergence data yet.</p>
        <button
          onClick={handleRerun}
          className="w-full px-3 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm font-medium"
        >
          Run Convergence Simulation
        </button>
      </div>
    );
  }

  if (isSimulating) {
    return (
      <div className="w-80 bg-white border-l border-slate-200 p-4 text-slate-400 text-sm flex items-center gap-2">
        <span className="animate-spin">⟳</span> Simulating convergence…
      </div>
    );
  }

  // ── Convergence view ─────────────────────────────────────────────────────────

  const stableRatio = step?.totalStableRatio ?? 0;
  const stablePercent = Math.round(stableRatio * 100);

  return (
    <div className="w-80 bg-white border-l border-slate-200 flex flex-col h-full text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-blue-50 border-b border-blue-200">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-blue-700">Convergence Replay</span>
          <span className="text-blue-400 text-[10px]">
            {totalTicks} tick{totalTicks !== 1 ? "s" : ""}
          </span>
        </div>
        <button onClick={handleBack} className="text-blue-400 hover:text-blue-700 text-[10px]">
          ← What-If
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Progress bar */}
        <div>
          <div className="flex justify-between mb-1 text-[10px] text-slate-500">
            <span>Stability: {stablePercent}%</span>
            <span>
              Tick {step?.tick ?? 0} / {convergenceSteps[totalTicks - 1]?.tick ?? 0}
            </span>
          </div>
          <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${stablePercent}%` }}
            />
          </div>
        </div>

        {/* Playback controls */}
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={handleRewind}
            disabled={currentTick === 0}
            className="p-1.5 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Rewind to start"
          >
            ⏮
          </button>
          <button
            onClick={handleStepBack}
            disabled={currentTick === 0}
            className="p-1.5 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Previous tick"
          >
            ◀
          </button>
          <button
            onClick={isPlaying ? stopPlay : startPlay}
            disabled={totalTicks === 0}
            className={`px-3 py-1.5 rounded font-medium text-sm ${
              isPlaying
                ? "bg-slate-200 hover:bg-slate-300 text-slate-700"
                : "bg-blue-500 hover:bg-blue-600 text-white"
            } disabled:opacity-40`}
          >
            {isPlaying ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            onClick={handleStepForward}
            disabled={currentTick >= totalTicks - 1}
            className="p-1.5 rounded bg-white border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Next tick"
          >
            ▶
          </button>
          <button
            onClick={handleRerun}
            className="p-1.5 rounded bg-white border border-slate-200 hover:bg-slate-50"
            title="Re-run simulation"
          >
            ↺
          </button>
        </div>

        {/* Tick slider */}
        <input
          type="range"
          min={0}
          max={Math.max(0, totalTicks - 1)}
          value={currentTick}
          onChange={(e) => {
            stopPlay();
            setCurrentTick(Number(e.target.value));
          }}
          className="w-full accent-blue-500"
        />

        {/* Tick detail */}
        {step && (
          <div className="space-y-2">
            {/* Stable nodes */}
            <div>
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                Stable Nodes ({step.stableNodes.length})
              </p>
              {step.stableNodes.length === 0 ? (
                <p className="text-slate-300 italic text-[11px]">None yet</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {step.stableNodes.map((id) => (
                    <span
                      key={id}
                      className="px-1.5 py-0.5 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded font-mono text-[10px]"
                    >
                      {id}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Routing updates at this tick */}
            {step.updates.affected_nodes.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                  Updated at this tick
                </p>
                <div className="flex flex-wrap gap-1">
                  {step.updates.affected_nodes.map((id) => (
                    <span
                      key={id}
                      className="px-1.5 py-0.5 bg-orange-50 border border-orange-200 text-orange-700 rounded font-mono text-[10px]"
                    >
                      {id}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Path changes at this tick */}
            {Object.keys(step.updates.updated_paths).length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">
                  Path Changes
                </p>
                <div className="space-y-0.5 max-h-48 overflow-y-auto">
                  {Object.entries(step.updates.updated_paths).flatMap(([nodeId, changes]) =>
                    changes.map((c, i) => (
                      <div
                        key={`${nodeId}-${i}`}
                        className="flex items-center gap-1 bg-white border border-slate-100 rounded px-2 py-1 font-mono"
                      >
                        <span className="text-slate-500 text-[10px]">{nodeId}</span>
                        <span className="text-slate-300 text-[10px]">›</span>
                        <span className="text-orange-700 text-[10px]">{c.prefix}</span>
                        <span className="ml-auto text-[10px]">
                          {c.new_next_hop === null ? (
                            <span className="text-red-500">no route</span>
                          ) : (
                            <span className="text-blue-600">{c.new_next_hop}</span>
                          )}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* All ticks summary */}
        <div>
          <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wide mb-1">
            All Ticks
          </p>
          <div className="flex gap-1 flex-wrap">
            {convergenceSteps.map((s, i) => (
              <button
                key={s.tick}
                onClick={() => {
                  stopPlay();
                  setCurrentTick(i);
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors ${
                  i === currentTick
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-white border-slate-200 hover:bg-blue-50 hover:border-blue-300"
                }`}
              >
                t{s.tick}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
