import { useState, useRef } from "react";
import { PanelFrame } from "./shared/PanelFrame";
import { useTopologyStore } from "../../stores/topology-store";
import {
  useCaptureStore,
  startCapture,
  stopCapture,
  type CaptureSession,
} from "../../stores/capture-store";

const PRESETS = [
  { key: "all",  label: "All" },
  { key: "bgp",  label: "BGP" },
  { key: "ospf", label: "OSPF" },
  { key: "isis", label: "IS-IS" },
  { key: "evpn", label: "EVPN" },
] as const;

const WS_BASE = import.meta.env.DEV
  ? "ws://localhost:8000/api"
  : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/api`;

export function CapturePanel() {
  const closePanel = () => useTopologyStore.getState().setActivePanel(null);
  const ir = useTopologyStore((s) => s.ir);
  const sessions = useCaptureStore((s) => s.sessions);
  const addSession = useCaptureStore((s) => s.addSession);
  const registerSocket = useCaptureStore((s) => s.registerSocket);

  const [node, setNode] = useState("");
  const [iface, setIface] = useState("");
  const [preset, setPreset] = useState<string>("all");
  const [customFilter, setCustomFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const nodeOptions = ir?.topology.nodes.map((n) => n.id) ?? [];

  const selectedNodeInterfaces = ir?.topology.nodes
    .find((n) => n.id === node)
    ?.interfaces ?? {};

  const handleStart = async () => {
    if (!node || !iface) { setError("Select node and interface"); return; }
    setError(null);
    setStarting(true);
    try {
      const filter = preset === "all" ? customFilter : "";
      const id = await startCapture(node, iface, filter, preset === "all" ? undefined : preset);

      addSession({
        id,
        node,
        interface: iface,
        filter: customFilter || preset,
        startedAt: new Date().toISOString(),
        running: true,
        bytesReceived: 0,
      });

      // Open WebSocket to receive pcap stream
      const ws = new WebSocket(`${WS_BASE}/capture/ws/${id}`);
      registerSocket(id, ws);

      ws.onmessage = (ev) => {
        // Each message is a base64-encoded pcap chunk
        const raw = ev.data as string;
        useCaptureStore.getState().incrementBytes(id, Math.round(raw.length * 0.75));
      };
      ws.onclose = () => {
        useCaptureStore.getState().removeSession(id);
      };
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <PanelFrame title="Packet Capture" onClose={closePanel}>
      {/* Start form */}
      <div className="space-y-2">
        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">Node</label>
          <select
            value={node}
            onChange={(e) => { setNode(e.target.value); setIface(""); }}
            className="w-full text-xs px-2 py-1.5 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">Select node…</option>
            {nodeOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">Interface</label>
          <select
            value={iface}
            onChange={(e) => setIface(e.target.value)}
            disabled={!node}
            className="w-full text-xs px-2 py-1.5 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
          >
            <option value="">Select interface…</option>
            {Object.keys(selectedNodeInterfaces).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        {/* Preset filter buttons */}
        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">Filter preset</label>
          <div className="flex gap-1 flex-wrap">
            {PRESETS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPreset(p.key)}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  preset === p.key
                    ? "bg-blue-500 text-white border-blue-500"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {preset === "all" && (
          <div>
            <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">
              Custom BPF filter
            </label>
            <input
              type="text"
              value={customFilter}
              onChange={(e) => setCustomFilter(e.target.value)}
              placeholder='e.g. "tcp port 80"'
              className="w-full text-xs font-mono px-2 py-1.5 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        )}

        {error && (
          <div className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </div>
        )}

        <button
          onClick={handleStart}
          disabled={starting || !node || !iface}
          className="w-full py-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-40 text-white text-xs font-semibold rounded transition-colors"
        >
          {starting ? "Starting…" : "Start Capture"}
        </button>
      </div>

      {/* Active sessions */}
      {Object.keys(sessions).length > 0 && (
        <div className="border-t border-slate-100 pt-3 space-y-2">
          <div className="text-[10px] text-slate-500 uppercase tracking-wide font-medium">
            Active captures
          </div>
          {Object.values(sessions).map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </PanelFrame>
  );
}

function SessionRow({ session }: { session: CaptureSession }) {
  const pcapRef = useRef<BlobPart[]>([]);

  const handleDownload = () => {
    // Offer download of accumulated pcap data as a .pcap file
    const blob = new Blob(pcapRef.current, { type: "application/vnd.tcpdump.pcap" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `capture-${session.node}-${session.interface}-${session.id}.pcap`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatBytes = (n: number) =>
    n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-2 text-xs">
      <div className="flex items-center justify-between mb-1">
        <span className="font-mono font-semibold text-slate-700">
          {session.node}/{session.interface}
        </span>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-slate-500">{formatBytes(session.bytesReceived)}</span>
        </span>
      </div>
      <div className="text-[10px] text-slate-400 mb-2 truncate">
        filter: <span className="font-mono">{session.filter || "(none)"}</span>
      </div>
      <div className="flex gap-1.5">
        <button
          onClick={handleDownload}
          className="flex-1 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px] font-medium"
        >
          Download .pcap
        </button>
        <button
          onClick={() => stopCapture(session.id)}
          className="flex-1 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded text-[10px] font-medium"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
