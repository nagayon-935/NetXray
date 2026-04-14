import React, { useEffect, useCallback } from 'react';
import { useDiagnosis } from '../../hooks/useDiagnosis';
import { useSnapshotStore } from '../../stores/snapshot-store';
import { useTopologyStore } from '../../stores/topology-store';
import { PanelFrame } from './shared/PanelFrame';

export const DiagnosisPanel: React.FC = () => {
  const { currentSnapshotId, snapshots } = useSnapshotStore();
  const liveIR = useTopologyStore((s) => s.ir);
  const setActivePanel = useTopologyStore((s) => s.setActivePanel);
  const { runDiagnosis, loading, error, issues } = useDiagnosis();

  // Resolve which IR to diagnose: prefer the selected snapshot, fall back to live IR
  const activeIR = (() => {
    if (currentSnapshotId) {
      const snap = snapshots.find((s) => s.id === currentSnapshotId);
      if (snap) return snap.ir;
    }
    return liveIR ?? null;
  })();

  // Auto-run whenever the active IR changes. runDiagnosis is stable (useCallback with
  // no deps), so it is safe to include in the dep array without risk of infinite loops.
  useEffect(() => {
    if (activeIR) {
      runDiagnosis(activeIR);
    }
  }, [currentSnapshotId, liveIR, runDiagnosis]);

  const handleRerun = useCallback(() => {
    if (activeIR) runDiagnosis(activeIR);
  }, [activeIR, runDiagnosis]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'warning':  return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'info':     return 'bg-blue-100 text-blue-800 border-blue-200';
      default:         return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const severityOrder = { critical: 0, warning: 1, info: 2 };
  const sortedIssues = [...issues].sort(
    (a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3),
  );

  const counts = { critical: 0, warning: 0, info: 0 };
  for (const issue of issues) {
    if (issue.severity in counts) counts[issue.severity as keyof typeof counts]++;
  }

  return (
    <PanelFrame title="Network Diagnosis" onClose={() => setActivePanel(null)} wide>
      <div className="flex justify-end mb-2">
        <button
          onClick={handleRerun}
          disabled={loading || !activeIR}
          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {loading ? 'Running…' : 'Re-run'}
        </button>
      </div>

      {!activeIR && (
        <div className="text-gray-400 text-sm">Load a topology to run diagnosis.</div>
      )}

      {error && <div className="text-red-500 mb-4 text-sm">Error: {error}</div>}

      {/* Summary badges */}
      {!loading && activeIR && (
        <div className="flex gap-2 mb-3">
          {counts.critical > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-800 font-semibold border border-red-200">
              {counts.critical} critical
            </span>
          )}
          {counts.warning > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800 font-semibold border border-yellow-200">
              {counts.warning} warning
            </span>
          )}
          {counts.info > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold border border-blue-200">
              {counts.info} info
            </span>
          )}
          {issues.length === 0 && (
            <span className="text-xs text-green-700 font-medium">✓ No issues detected</span>
          )}
        </div>
      )}

      {loading && <div className="text-blue-500 text-sm animate-pulse mb-2">Analyzing topology…</div>}

      <div className="flex-1 overflow-y-auto space-y-3">
        {sortedIssues.map((issue, idx) => (
          <div key={`${issue.category}:${issue.message}:${idx}`} className={`p-3 rounded border ${getSeverityColor(issue.severity)}`}>
            <div className="flex justify-between items-start mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">{issue.category}</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white bg-opacity-50">
                {issue.severity}
              </span>
            </div>
            <p className="text-sm">{issue.message}</p>
            {issue.node_ids.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {issue.node_ids.map((nodeId) => (
                  <span key={nodeId} className="text-[10px] bg-white bg-opacity-50 px-1.5 py-0.5 rounded font-mono">
                    {nodeId}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </PanelFrame>
  );
};
