/**
 * WhatIfPanel — What-If analysis UI.
 *
 * Allows users to:
 *  1. Add link / node failures to a scenario
 *  2. Run the simulation to see which nodes are affected
 *  3. Navigate to ConvergencePanel for step-by-step replay
 */

import { useCallback } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { useWhatIfStore } from "../../stores/whatif-store";
import type { FailureSpec } from "../../engine/types";

export function WhatIfPanel() {
  const ir = useTopologyStore((s) => s.ir);
  const setActivePanel = useTopologyStore((s) => s.setActivePanel);

  const {
    isActive,
    baseIR,
    failures,
    routingUpdate,
    affectedNodes,
    convergenceSteps,
    isSimulating,
    activate,
    deactivate,
    addFailure,
    removeFailure,
    clearFailures,
    runSimulation,
    runConvergence,
  } = useWhatIfStore();

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleActivate = useCallback(() => {
    if (!ir) return;
    activate(ir);
  }, [ir, activate]);

  const handleDeactivate = useCallback(() => {
    deactivate();
  }, [deactivate]);

  const handleAddLink = useCallback(
    (linkId: string) => {
      addFailure({ kind: "link", id: linkId });
    },
    [addFailure]
  );

  const handleAddNode = useCallback(
    (nodeId: string) => {
      addFailure({ kind: "node", id: nodeId });
    },
    [addFailure]
  );

  const handleRemove = useCallback(
    (spec: FailureSpec) => {
      removeFailure(spec);
    },
    [removeFailure]
  );

  const handleSimulate = useCallback(() => {
    runSimulation();
  }, [runSimulation]);

  const handleConvergence = useCallback(() => {
    runConvergence();
    setActivePanel("convergence");
  }, [runConvergence, setActivePanel]);

  // ── No IR loaded ─────────────────────────────────────────────────────────────

  if (!ir) {
    return (
      <div className="w-80 bg-white border-l border-slate-200 p-4 text-slate-400 text-sm">
        Load a topology first to run What-If analysis.
      </div>
    );
  }

  // ── Entry state (not yet active) ─────────────────────────────────────────────

  if (!isActive) {
    return (
      <div className="w-80 bg-white border-l border-slate-200 p-4 space-y-3">
        <p className="text-sm text-slate-600">
          Simulate link or node failures and see how routing changes without affecting
          the live topology.
        </p>
        <button
          onClick={handleActivate}
          className="w-full px-3 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded text-sm font-medium transition-colors"
        >
          Start What-If Session
        </button>
      </div>
    );
  }

  // ── Active session ───────────────────────────────────────────────────────────

  const nodes = baseIR?.topology.nodes ?? [];
  const links = baseIR?.topology.links ?? [];

  const failedNodeIds = new Set(
    failures.filter((f) => f.kind === "node").map((f) => f.id)
  );
  const failedLinkIds = new Set(
    failures.filter((f) => f.kind === "link").map((f) => f.id)
  );

  // Paths changed: only show nodes whose routing table was affected
  const changedPaths =
    routingUpdate?.updated_paths
      ? Object.entries(routingUpdate.updated_paths).flatMap(([nodeId, changes]) =>
          changes.map((c) => ({ nodeId, ...c }))
        )
      : [];

  return (
    <div className="w-80 bg-white border-l border-slate-200 flex flex-col h-full text-xs">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-orange-50 border-b border-orange-200">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-orange-500 animate-pulse" />
          <span className="font-semibold text-orange-700">What-If Mode</span>
        </div>
        <button
          onClick={handleDeactivate}
          className="text-slate-400 hover:text-slate-600 text-xs"
          title="Exit What-If mode"
        >
          ✕ Exit
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 p-3">
        {/* Failure scenario builder */}
        <section>
          <div className="flex items-center justify-between mb-1.5">
            <h3 className="font-semibold text-slate-700">Failure Scenario</h3>
            {failures.length > 0 && (
              <button
                onClick={clearFailures}
                className="text-slate-400 hover:text-red-500 text-[10px]"
              >
                Clear all
              </button>
            )}
          </div>

          {/* Active failures */}
          {failures.length === 0 ? (
            <p className="text-slate-400 text-[11px] italic">No failures defined yet.</p>
          ) : (
            <ul className="space-y-1 mb-2">
              {failures.map((f) => (
                <li
                  key={`${f.kind}-${f.id}`}
                  className="flex items-center justify-between bg-red-50 border border-red-200 rounded px-2 py-1"
                >
                  <span className="font-mono text-red-700">
                    <span className="uppercase text-[9px] font-semibold bg-red-100 px-1 rounded mr-1">
                      {f.kind}
                    </span>
                    {f.id}
                  </span>
                  <button
                    onClick={() => handleRemove(f)}
                    className="text-red-300 hover:text-red-600 ml-2"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          {/* Add node failure */}
          <div className="space-y-1">
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">
              Add Node Failure
            </p>
            <div className="flex flex-wrap gap-1">
              {nodes
                .filter((n) => !failedNodeIds.has(n.id))
                .map((n) => (
                  <button
                    key={n.id}
                    onClick={() => handleAddNode(n.id)}
                    className="px-2 py-0.5 bg-white border border-slate-200 rounded hover:bg-red-50 hover:border-red-300 hover:text-red-700 transition-colors"
                  >
                    {n.hostname ?? n.id}
                  </button>
                ))}
              {nodes.every((n) => failedNodeIds.has(n.id)) && (
                <span className="text-slate-300 italic">All nodes failed</span>
              )}
            </div>
          </div>

          {/* Add link failure */}
          <div className="space-y-1 mt-2">
            <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">
              Add Link Failure
            </p>
            <div className="flex flex-wrap gap-1">
              {links
                .filter((l) => !failedLinkIds.has(l.id))
                .map((l) => {
                  const srcLabel = l.source.node.replace("router", "R").replace("spine", "S").replace("leaf", "L");
                  const dstLabel = l.target.node.replace("router", "R").replace("spine", "S").replace("leaf", "L");
                  return (
                    <button
                      key={l.id}
                      onClick={() => handleAddLink(l.id)}
                      title={l.id}
                      className="px-2 py-0.5 bg-white border border-slate-200 rounded hover:bg-red-50 hover:border-red-300 hover:text-red-700 transition-colors font-mono"
                    >
                      {srcLabel}—{dstLabel}
                    </button>
                  );
                })}
              {links.every((l) => failedLinkIds.has(l.id)) && (
                <span className="text-slate-300 italic">All links failed</span>
              )}
            </div>
          </div>
        </section>

        {/* Run buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleSimulate}
            disabled={failures.length === 0 || isSimulating}
            className="flex-1 px-3 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors"
          >
            {isSimulating ? "Simulating…" : "Run Simulation"}
          </button>
          <button
            onClick={handleConvergence}
            disabled={failures.length === 0 || isSimulating}
            title="Show step-by-step convergence"
            className="px-3 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-slate-200 disabled:text-slate-400 disabled:cursor-not-allowed text-white rounded text-sm font-medium transition-colors"
          >
            Convergence
          </button>
        </div>

        {/* Results */}
        {routingUpdate && (
          <section>
            <h3 className="font-semibold text-slate-700 mb-1.5">Impact Summary</h3>

            {affectedNodes.length === 0 ? (
              <p className="text-emerald-600 bg-emerald-50 border border-emerald-200 rounded p-2">
                No routing changes detected — topology is resilient to this failure.
              </p>
            ) : (
              <>
                <div className="bg-red-50 border border-red-200 rounded p-2 mb-2">
                  <p className="text-red-700 font-medium mb-1">
                    {affectedNodes.length} node{affectedNodes.length !== 1 ? "s" : ""} affected
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {affectedNodes.map((id) => (
                      <span
                        key={id}
                        className="px-1.5 py-0.5 bg-red-100 text-red-700 rounded font-mono text-[10px]"
                      >
                        {id}
                      </span>
                    ))}
                  </div>
                </div>

                {changedPaths.length > 0 && (
                  <div>
                    <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide mb-1">
                      Routing Changes
                    </p>
                    <div className="space-y-0.5 max-h-48 overflow-y-auto">
                      {changedPaths.map((c) => (
                        <div
                          key={`${c.nodeId}-${c.prefix}`}
                          className="flex items-center gap-1 bg-white border border-slate-100 rounded px-2 py-1 font-mono"
                        >
                          <span className="text-slate-500 text-[10px]">{c.nodeId}</span>
                          <span className="text-slate-300">›</span>
                          <span className="text-orange-700">{c.prefix}</span>
                          <span className="text-slate-300 ml-auto">
                            {c.new_next_hop === null ? (
                              <span className="text-red-500">no route</span>
                            ) : (
                              <span className="text-blue-600">{c.new_next_hop}</span>
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {/* Convergence steps preview */}
        {convergenceSteps.length > 0 && (
          <section>
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-slate-700">Convergence</h3>
              <button
                onClick={() => setActivePanel("convergence")}
                className="text-blue-500 hover:text-blue-700 text-[10px]"
              >
                Open full view →
              </button>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded p-2 text-blue-700">
              {convergenceSteps.length} ticks — network stabilises at tick{" "}
              {convergenceSteps[convergenceSteps.length - 1]?.tick ?? 0}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
