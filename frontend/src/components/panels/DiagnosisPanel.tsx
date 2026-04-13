import React, { useEffect } from 'react';
import { useDiagnosis } from '../../hooks/useDiagnosis';
import { useSnapshotStore } from '../../stores/snapshot-store';

export const DiagnosisPanel: React.FC = () => {
  const { currentSnapshotId, snapshots } = useSnapshotStore();
  const { runDiagnosis, loading, error, issues } = useDiagnosis();

  useEffect(() => {
    const currentSnap = snapshots.find(s => s.id === currentSnapshotId);
    if (currentSnap) {
      runDiagnosis(currentSnap.ir);
    }
  }, [currentSnapshotId, snapshots]);

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical': return 'bg-red-100 text-red-800 border-red-200';
      case 'warning': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'info': return 'bg-blue-100 text-blue-800 border-blue-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  return (
    <div className="p-4 h-full flex flex-col">
      <h3 className="text-lg font-bold mb-4">Network Diagnosis</h3>
      {loading && <div className="text-blue-500 mb-4">Analyzing topology...</div>}
      {error && <div className="text-red-500 mb-4">Error: {error}</div>}
      
      {!loading && issues.length === 0 && (
        <div className="text-green-600 font-medium p-4 bg-green-50 rounded border border-green-200">
          ✓ No issues detected in the current snapshot.
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-3">
        {issues.map((issue, idx) => (
          <div key={idx} className={`p-3 rounded border ${getSeverityColor(issue.severity)}`}>
            <div className="flex justify-between items-start mb-1">
              <span className="text-xs font-bold uppercase tracking-wider">{issue.category}</span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-white bg-opacity-50">
                {issue.severity}
              </span>
            </div>
            <p className="text-sm">{issue.message}</p>
            {issue.node_ids.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {issue.node_ids.map(nodeId => (
                  <span key={nodeId} className="text-[10px] bg-white bg-opacity-50 px-1.5 py-0.5 rounded">
                    {nodeId}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
