import { useCallback, useRef } from "react";
import { useLabStore, type LabStatus } from "../stores/lab-store";

const WS_BASE = import.meta.env.DEV
  ? "ws://localhost:8000/api/ws"
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api/ws`;

export function useLabControl() {
  const wsRef = useRef<WebSocket | null>(null);
  const { setStatus, setRunId, appendLog, clearLogs } = useLabStore.getState();

  const closeWS = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
  }, []);

  const startLifecycle = useCallback(
    async (
      action: "deploy" | "destroy" | "redeploy",
      topologyFile: string,
      extra: Record<string, unknown> = {},
    ) => {
      closeWS();
      clearLogs();

      const labStatus: LabStatus =
        action === "deploy" ? "deploying" : action === "destroy" ? "destroying" : "redeploying";
      setStatus(labStatus);

      let runId: string;
      try {
        const res = await fetch(`/api/lab/${action}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topology_file: topologyFile, ...extra }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { detail?: string }).detail ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as { run_id: string };
        runId = data.run_id;
      } catch (e) {
        appendLog(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
        setStatus("error");
        return;
      }

      setRunId(runId);
      const ws = new WebSocket(`${WS_BASE}/lab/${runId}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as {
            type: string;
            line?: string;
            code?: number;
            message?: string;
          };
          if (msg.type === "log" && msg.line !== undefined) {
            appendLog(msg.line);
          } else if (msg.type === "exit") {
            setStatus(msg.code === 0 ? "done" : "error");
            closeWS();
          } else if (msg.type === "error") {
            appendLog(`ERROR: ${msg.message ?? "unknown"}`);
            setStatus("error");
            closeWS();
          }
        } catch {
          // ignore malformed frames
        }
      };

      ws.onerror = () => {
        appendLog("WebSocket connection error");
        setStatus("error");
      };
    },
    [closeWS, setStatus, setRunId, appendLog, clearLogs],
  );

  return {
    deploy: (f: string, opts?: { reconfigure?: boolean }) =>
      startLifecycle("deploy", f, opts ?? {}),
    destroy: (f: string, opts?: { cleanup?: boolean }) =>
      startLifecycle("destroy", f, opts ?? {}),
    redeploy: (f: string, opts?: { cleanup?: boolean }) =>
      startLifecycle("redeploy", f, opts ?? {}),
  };
}
