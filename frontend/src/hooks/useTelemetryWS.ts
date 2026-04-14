import { useEffect, useRef } from "react";
import { useTopologyStore } from "../stores/topology-store";

/**
 * Opens a WebSocket to `/api/ws/topology/{topologyName}` and applies
 * incoming JSON Patch arrays to the topology IR.
 *
 * Features:
 * - Auto-reconnects after 5 s on unexpected close.
 * - Reconnect timer is always cancelled on unmount (no leak).
 * - Passing `undefined` as `topologyName` disables the connection
 *   (used to avoid connecting before an IR is loaded).
 */
export function useTelemetryWS(topologyName: string | undefined) {
  const applyPatches = useTopologyStore((s) => s.applyPatches);

  // Use refs so inner callbacks always see the latest values without
  // recreating the effect when they change.
  const applyPatchesRef = useRef(applyPatches);
  applyPatchesRef.current = applyPatches;

  useEffect(() => {
    if (!topologyName) return;

    let ws: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let active = true; // set to false on cleanup

    function openConnection() {
      if (!active) return;

      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${window.location.host}/api/ws/topology/${topologyName}`;
      ws = new WebSocket(url);

      ws.onopen = () => {
        console.debug(`[TelemetryWS] connected to ${topologyName}`);
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const patches = JSON.parse(event.data as string);
          if (Array.isArray(patches)) {
            applyPatchesRef.current(patches);
          }
        } catch (err) {
          console.warn("[TelemetryWS] failed to parse patch message:", err);
        }
      };

      ws.onclose = (event) => {
        if (!active) return; // cleanup already ran — don't reconnect
        if (!event.wasClean) {
          console.debug(`[TelemetryWS] disconnected (code ${event.code}), reconnecting in 5 s…`);
          reconnectTimer = setTimeout(openConnection, 5_000);
        }
      };

      ws.onerror = () => {
        // onerror is always followed by onclose, so the reconnect is
        // handled there.  Just log here.
        console.debug("[TelemetryWS] socket error");
      };
    }

    openConnection();

    return () => {
      active = false;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws !== null) {
        ws.close();
        ws = null;
      }
    };
  }, [topologyName]); // applyPatches is stable from Zustand — no need in deps
}
