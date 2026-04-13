import { useEffect, useRef, useCallback } from 'react';
import { useTopologyStore } from '../stores/topology-store';

export function useTelemetryWS(topologyName: string | undefined) {
  const ws = useRef<WebSocket | null>(null);
  const applyPatches = useTopologyStore((s) => s.applyPatches);

  const connect = useCallback(() => {
    if (!topologyName) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host; 
    const wsUrl = `${protocol}//${host}/api/ws/topology/${topologyName}`;
    
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('Telemetry WebSocket connected');
    };

    ws.current.onmessage = (event) => {
      try {
        const patches = JSON.parse(event.data);
        if (Array.isArray(patches)) {
          applyPatches(patches);
        }
      } catch (err) {
        console.error('Error parsing telemetry patch', err);
      }
    };

    ws.current.onclose = () => {
      console.log('Telemetry WebSocket disconnected, retrying in 5s...');
      setTimeout(connect, 5000);
    };

    ws.current.onerror = (err) => {
      console.error('Telemetry WebSocket error', err);
      ws.current?.close();
    };
  }, [topologyName, applyPatches]);

  useEffect(() => {
    connect();
    return () => {
      ws.current?.close();
    };
  }, [connect]);

  const subscribe = async (nodeIds: string[]) => {
    if (!topologyName) return;
    try {
      await fetch('/api/telemetry/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          topology_name: topologyName,
          nodes: nodeIds
        })
      });
    } catch (err) {
      console.error('Failed to subscribe to telemetry', err);
    }
  };

  return { subscribe };
}
