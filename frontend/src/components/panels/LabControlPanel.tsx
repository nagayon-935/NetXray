import { useEffect, useRef, useState } from "react";
import { useLabStore } from "../../stores/lab-store";
import { useLabControl } from "../../hooks/useLabControl";
import { PanelFrame } from "./shared/PanelFrame";
import { useTopologyStore } from "../../stores/topology-store";

const STATUS_LABEL: Record<string, string> = {
  idle:       "Idle",
  deploying:  "Deploying…",
  destroying: "Destroying…",
  redeploying:"Redeploying…",
  done:       "Done",
  error:      "Error",
};

const STATUS_COLOR: Record<string, string> = {
  idle:        "text-slate-400",
  deploying:   "text-blue-500",
  destroying:  "text-red-400",
  redeploying: "text-amber-500",
  done:        "text-emerald-500",
  error:       "text-red-600",
};

export function LabControlPanel() {
  const closePanel = () => useTopologyStore.getState().setActivePanel(null);
  const { deploy, destroy, redeploy } = useLabControl();

  const status       = useLabStore((s) => s.status);
  const logs         = useLabStore((s) => s.logs);
  const topologyFile = useLabStore((s) => s.topologyFile);
  const setTopologyFile = useLabStore((s) => s.setTopologyFile);

  const [cleanup, setCleanup] = useState(false);
  const [showLogs, setShowLogs] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);

  const busy = status === "deploying" || status === "destroying" || status === "redeploying";

  // Auto-scroll log to bottom
  useEffect(() => {
    if (logRef.current && showLogs) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs, showLogs]);

  return (
    <PanelFrame title="Lab Control" onClose={closePanel}>
      {/* Topology file input */}
      <div className="p-3 border-b border-slate-100 space-y-2">
        <label className="block text-[10px] text-slate-500 uppercase tracking-wide">
          Topology File (.clab.yml)
        </label>
        <input
          type="text"
          value={topologyFile}
          onChange={(e) => setTopologyFile(e.target.value)}
          placeholder="path/to/topology.clab.yml"
          disabled={busy}
          className="w-full text-xs font-mono px-2 py-1.5 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        />
        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={cleanup}
            onChange={(e) => setCleanup(e.target.checked)}
            disabled={busy}
            className="accent-blue-500"
          />
          --cleanup (remove bridge/mounts)
        </label>
      </div>

      {/* Action buttons */}
      <div className="p-3 border-b border-slate-100 flex gap-2">
        <ActionBtn
          label="Deploy"
          color="bg-emerald-500 hover:bg-emerald-600"
          disabled={busy || !topologyFile}
          onClick={() => deploy(topologyFile)}
        />
        <ActionBtn
          label="Redeploy"
          color="bg-blue-500 hover:bg-blue-600"
          disabled={busy || !topologyFile}
          onClick={() => redeploy(topologyFile, { cleanup })}
        />
        <ActionBtn
          label="Destroy"
          color="bg-red-500 hover:bg-red-600"
          disabled={busy || !topologyFile}
          onClick={() => destroy(topologyFile, { cleanup })}
        />
      </div>

      {/* Status bar */}
      <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
        <span className={`text-xs font-semibold ${STATUS_COLOR[status]}`}>
          {STATUS_LABEL[status]}
        </span>
        <button
          onClick={() => setShowLogs((v) => !v)}
          className="text-[10px] text-slate-400 hover:text-slate-600"
        >
          {showLogs ? "Hide logs" : "Show logs"}
        </button>
      </div>

      {/* Log viewer */}
      {showLogs && (
        <pre
          ref={logRef}
          className="flex-1 overflow-y-auto text-[10px] font-mono leading-relaxed p-3 bg-slate-950 text-slate-200 whitespace-pre-wrap break-all max-h-96"
        >
          {logs.length === 0
            ? <span className="text-slate-500">No output yet.</span>
            : logs.join("\n")}
        </pre>
      )}
    </PanelFrame>
  );
}

function ActionBtn({
  label,
  color,
  disabled,
  onClick,
}: {
  label: string;
  color: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 py-1.5 rounded text-xs font-semibold text-white transition-colors
        disabled:opacity-40 disabled:cursor-not-allowed ${color}`}
    >
      {label}
    </button>
  );
}
