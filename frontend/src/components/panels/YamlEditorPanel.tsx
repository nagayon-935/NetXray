import { useState, useEffect, useRef, useCallback } from "react";
import { PanelFrame } from "./shared/PanelFrame";
import { useTopologyStore } from "../../stores/topology-store";

const WS_BASE = import.meta.env.DEV
  ? "ws://localhost:8000/api"
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api`;

type DeployStatus = "idle" | "saving" | "deploying" | "done" | "error";

export function YamlEditorPanel() {
  const closePanel = () => useTopologyStore.getState().setActivePanel(null);
  const ir = useTopologyStore((s) => s.ir);

  const [yaml, setYaml] = useState("");
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const [deployStatus, setDeployStatus] = useState<DeployStatus>("idle");
  const [deployError, setDeployError] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const fetchYaml = useCallback(async () => {
    if (!ir) return;
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/iac/export/clab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ir }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { clab_yaml: string };
      setYaml(data.clab_yaml);
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [ir]);

  useEffect(() => {
    fetchYaml();
  }, [fetchYaml]);

  // Auto-scroll logs
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  const handleCopy = () => {
    navigator.clipboard.writeText(yaml).catch(() => {});
  };

  const handleDownload = () => {
    const topoName = "netxray-exported";
    const blob = new Blob([yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${topoName}.clab.yml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeploy = async () => {
    if (!yaml) return;
    setDeployStatus("saving");
    setDeployError(null);
    setLogs([]);

    try {
      const topoName = "netxray-exported";
      const res = await fetch("/api/iac/deploy-clab", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clab_yaml: yaml, topo_name: topoName }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { detail?: string };
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { run_id: string };
      setDeployStatus("deploying");

      const ws = new WebSocket(`${WS_BASE}/lab/${data.run_id}`);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data as string) as { type: string; line?: string; code?: number; message?: string };
          if (msg.type === "log" && msg.line) {
            setLogs((prev) => [...prev.slice(-1999), msg.line!]);
          } else if (msg.type === "exit") {
            setDeployStatus(msg.code === 0 ? "done" : "error");
            if (msg.code !== 0) setDeployError(`Exited with code ${msg.code}`);
            ws.close();
          } else if (msg.type === "error") {
            setDeployError(msg.message ?? "Unknown error");
            setDeployStatus("error");
            ws.close();
          }
        } catch {
          // ignore parse errors
        }
      };
      ws.onerror = () => {
        setDeployStatus("error");
        setDeployError("WebSocket connection failed");
      };
    } catch (e) {
      setDeployStatus("error");
      setDeployError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleStopDeploy = () => {
    wsRef.current?.close();
    setDeployStatus("idle");
    setLogs([]);
  };

  const busy = deployStatus === "saving" || deployStatus === "deploying";

  const statusColor: Record<DeployStatus, string> = {
    idle: "text-slate-400",
    saving: "text-blue-500",
    deploying: "text-amber-500",
    done: "text-emerald-600",
    error: "text-red-600",
  };
  const statusLabel: Record<DeployStatus, string> = {
    idle: "",
    saving: "Saving topology…",
    deploying: "Deploying…",
    done: "Deployed successfully",
    error: deployError ?? "Error",
  };

  return (
    <PanelFrame title="Topology YAML" onClose={closePanel} wide>
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-2">
        <button
          onClick={fetchYaml}
          disabled={loading || !ir}
          className="px-2 py-1 text-[11px] bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
        >
          {loading ? "Loading…" : "Refresh"}
        </button>
        <button
          onClick={handleCopy}
          disabled={!yaml}
          className="px-2 py-1 text-[11px] bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
        >
          Copy
        </button>
        <button
          onClick={handleDownload}
          disabled={!yaml}
          className="px-2 py-1 text-[11px] bg-white border border-slate-200 rounded hover:bg-slate-50 disabled:opacity-40"
        >
          Download .yml
        </button>
        <div className="flex-1" />
        {deployStatus !== "idle" && (
          <span className={`text-[11px] font-medium ${statusColor[deployStatus]}`}>
            {statusLabel[deployStatus]}
          </span>
        )}
        {busy ? (
          <button
            onClick={handleStopDeploy}
            className="px-3 py-1.5 text-[11px] bg-red-50 border border-red-300 text-red-600 rounded hover:bg-red-100"
          >
            Cancel
          </button>
        ) : (
          <button
            onClick={handleDeploy}
            disabled={!yaml}
            className="px-3 py-1.5 text-[11px] bg-emerald-500 hover:bg-emerald-600 text-white font-semibold rounded disabled:opacity-40 transition-colors"
          >
            Deploy to Lab
          </button>
        )}
      </div>

      {fetchError && (
        <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1 mb-2">
          {fetchError}
        </div>
      )}

      {/* YAML textarea */}
      <textarea
        value={yaml}
        onChange={(e) => setYaml(e.target.value)}
        spellCheck={false}
        className="w-full h-72 font-mono text-[11px] p-2 border border-slate-200 rounded bg-slate-50 resize-none focus:outline-none focus:ring-1 focus:ring-blue-400"
        placeholder={loading ? "Generating YAML…" : "Load a topology to see its containerlab YAML"}
      />

      {/* Deploy log viewer */}
      {logs.length > 0 && (
        <div
          ref={logRef}
          className="mt-2 h-40 overflow-y-auto bg-slate-900 text-emerald-300 text-[10px] font-mono p-2 rounded leading-relaxed"
        >
          {logs.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
    </PanelFrame>
  );
}
