import React, { useEffect } from 'react';
import { useConfigGen } from '../../hooks/useConfigGen';
import { useSnapshotStore } from '../../stores/snapshot-store';
import { useTopologyStore } from '../../stores/topology-store';

interface ConfigGenPanelProps {
  selectedNodeId: string | null;
}

export const ConfigGenPanel: React.FC<ConfigGenPanelProps> = ({ selectedNodeId }) => {
  const { currentSnapshotId, snapshots } = useSnapshotStore();
  const { ir } = useTopologyStore();
  const { generateConfig, loading, error, result } = useConfigGen();

  useEffect(() => {
    if (selectedNodeId && currentSnapshotId && ir) {
      const currentSnap = snapshots.find(s => s.id === currentSnapshotId);
      const baseSnap = snapshots[0]; // For demo, compare with the first snapshot

      if (currentSnap && baseSnap) {
        generateConfig(baseSnap.ir, currentSnap.ir, selectedNodeId);
      }
    }
  }, [selectedNodeId, currentSnapshotId, ir, snapshots]);

  if (!selectedNodeId) {
    return (
      <div className="p-4 text-gray-500">
        Select a node to generate configuration commands.
      </div>
    );
  }

  return (
    <div className="p-4 flex flex-col h-full">
      <h3 className="text-lg font-bold mb-4">Configuration Generator</h3>
      {loading && <div className="text-blue-500">Generating commands...</div>}
      {error && <div className="text-red-500">Error: {error}</div>}
      {result && (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="mb-2 text-sm font-medium">
            Vendor: <span className="uppercase text-blue-600">{result.vendor}</span>
          </div>
          <div className="flex-1 bg-gray-900 text-green-400 p-4 font-mono text-sm overflow-y-auto rounded shadow-inner relative group">
            <button
              onClick={() => navigator.clipboard.writeText(result.commands.join('\n'))}
              className="absolute top-2 right-2 bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity"
            >
              Copy
            </button>
            <pre>
              {result.commands.length > 0 
                ? result.commands.join('\n') 
                : '! No changes detected or generator not implemented'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};
