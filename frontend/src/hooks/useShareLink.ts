import { useCallback } from 'react';
import { useTopologyStore } from '../stores/topology-store';
import { useSnapshotStore } from '../stores/snapshot-store';
import { encodeShareState, decodeShareState } from '../lib/share';

export function useShareLink() {
  const ir = useTopologyStore((s) => s.ir);
  const snapshots = useSnapshotStore((s) => s.snapshots);
  const loadIR = useTopologyStore((s) => s.loadIR);
  const setSnapshots = useSnapshotStore((s) => s.setSnapshots);

  const generateShareLink = useCallback(async () => {
    if (!ir) return null;
    
    const state = {
      ir,
      snapshots: snapshots.map(s => ({ 
        id: s.id, 
        timestamp: s.timestamp, 
        label: s.label, 
        ir: s.ir 
      }))
    };
    
    const encoded = await encodeShareState(state);
    const url = new URL(window.location.href);
    url.hash = `share=${encoded}`;
    return url.toString();
  }, [ir, snapshots]);

  const loadFromHash = useCallback(async () => {
    const hash = window.location.hash;
    if (hash.startsWith('#share=')) {
      const encoded = hash.substring(7);
      try {
        const state = await decodeShareState(encoded);
        if (state.ir) {
          loadIR(state.ir);
        }
        if (state.snapshots) {
          setSnapshots(state.snapshots);
        }
        return true;
      } catch (err) {
        console.error('Failed to decode share state', err);
      }
    }
    return false;
  }, [loadIR, setSnapshots]);

  return { generateShareLink, loadFromHash };
}
