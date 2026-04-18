import { useState, useEffect } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { useImpairmentStore, type ImpairmentSpec } from "../../stores/impairment-store";
import { PanelFrame } from "./shared/PanelFrame";
import type { Node, Link, Interface } from "../../types/netxray-ir";

export function LinkDetailPanel() {
  const ir = useTopologyStore((s) => s.ir);
  const selectedLinkId = useTopologyStore((s) => s.selectedLinkId);
  const toggleLinkState = useTopologyStore((s) => s.toggleLinkState);
  const applyPatches = useTopologyStore((s) => s.applyPatches);
  const closePanel = () => useTopologyStore.getState().setActivePanel(null);

  if (!ir || !selectedLinkId) return null;

  const link = ir.topology.links.find((l) => l.id === selectedLinkId);
  if (!link) return null;

  const sourceNode = ir.topology.nodes.find((n) => n.id === link.source.node);
  const targetNode = ir.topology.nodes.find((n) => n.id === link.target.node);

  const sourceIface = sourceNode?.interfaces?.[link.source.interface];
  const targetIface = targetNode?.interfaces?.[link.target.interface];

  return (
    <PanelFrame title="Link Details" onClose={closePanel}>
      <div className="text-[10px] text-slate-400 font-mono -mt-2">{link.id}</div>
      <div className="p-3 border-b border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-500 font-medium">Link State</span>
        <button
          onClick={() => toggleLinkState(link.id)}
          className={`relative inline-flex h-6 w-16 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
            link.state === "up" ? "bg-emerald-500" : "bg-rose-500"
          }`}
        >
          <span
            className={`absolute left-2 text-[10px] font-bold text-white transition-opacity duration-200 ease-in-out ${
              link.state === "up" ? "opacity-100" : "opacity-0"
            }`}
          >
            UP
          </span>
          <span
            className={`absolute right-1.5 text-[10px] font-bold text-white transition-opacity duration-200 ease-in-out ${
              link.state === "up" ? "opacity-0" : "opacity-100"
            }`}
          >
            DOWN
          </span>
          <span
            aria-hidden="true"
            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
              link.state === "up" ? "translate-x-11" : "translate-x-0"
            }`}
          />
        </button>
      </div>

      <div className="p-3 space-y-4">
        {sourceNode && sourceIface && (
          <InterfaceEditor
            node={sourceNode}
            ifaceName={link.source.interface}
            iface={sourceIface}
            applyPatches={applyPatches}
            title="Source Interface"
          />
        )}
        {targetNode && targetIface && (
          <InterfaceEditor
            node={targetNode}
            ifaceName={link.target.interface}
            iface={targetIface}
            applyPatches={applyPatches}
            title="Target Interface"
          />
        )}
      </div>

      <ImpairmentSection link={link} />
    </PanelFrame>
  );
}

// ── Impairment Section ────────────────────────────────────────────────────────

function ImpairmentSection({ link }: { link: Link }) {
  const existing = useImpairmentStore((s) => s.impairments[link.id]);
  const setImpairment = useImpairmentStore((s) => s.setImpairment);
  const clearImpairment = useImpairmentStore((s) => s.clearImpairment);

  const [delay, setDelay] = useState(existing?.delay_ms?.toString() ?? "");
  const [jitter, setJitter] = useState(existing?.jitter_ms?.toString() ?? "");
  const [loss, setLoss] = useState(existing?.loss_pct?.toString() ?? "");
  const [rate, setRate] = useState(existing?.rate_kbit?.toString() ?? "");
  const [corruption, setCorruption] = useState(existing?.corruption_pct?.toString() ?? "");
  const [bothDirections, setBothDirections] = useState(existing?.bothDirections ?? true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (existing) {
      setDelay(existing.delay_ms?.toString() ?? "");
      setJitter(existing.jitter_ms?.toString() ?? "");
      setLoss(existing.loss_pct?.toString() ?? "");
      setRate(existing.rate_kbit?.toString() ?? "");
      setCorruption(existing.corruption_pct?.toString() ?? "");
      setBothDirections(existing.bothDirections);
    } else {
      setDelay(""); setJitter(""); setLoss(""); setRate(""); setCorruption("");
    }
    // Reset form when navigating to a different link; intentionally exclude
    // `existing` to avoid re-running when the store updates mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [link.id]);

  const parse = (v: string): number | null => {
    const n = parseFloat(v);
    return isNaN(n) ? null : n;
  };

  const handleApply = async () => {
    setLoading(true);
    setError(null);
    const spec: ImpairmentSpec = {
      sourceNode: link.source.node,
      sourceInterface: link.source.interface,
      targetNode: link.target.node,
      targetInterface: link.target.interface,
      delay_ms: parse(delay),
      jitter_ms: parse(jitter),
      loss_pct: parse(loss),
      rate_kbit: parse(rate),
      corruption_pct: parse(corruption),
      bothDirections,
    };
    try {
      const res = await fetch("/api/link/impairment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_node: spec.sourceNode,
          source_interface: spec.sourceInterface,
          target_node: spec.targetNode,
          target_interface: spec.targetInterface,
          delay_ms: spec.delay_ms,
          jitter_ms: spec.jitter_ms,
          loss_pct: spec.loss_pct,
          rate_kbit: spec.rate_kbit,
          corruption_pct: spec.corruption_pct,
          both_directions: spec.bothDirections,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      setImpairment(link.id, spec);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleClear = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/link/impairment", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_node: link.source.node,
          source_interface: link.source.interface,
          target_node: link.target.node,
          target_interface: link.target.interface,
          both_directions: bothDirections,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail ?? `HTTP ${res.status}`);
      }
      clearImpairment(link.id);
      setDelay(""); setJitter(""); setLoss(""); setRate(""); setCorruption("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-slate-100">
      <div className="p-3 pb-0 flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">Link Impairment</span>
        {existing && (
          <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
            ACTIVE
          </span>
        )}
      </div>

      <div className="p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <ImpairmentField label="Delay (ms)" value={delay} onChange={setDelay} placeholder="0" />
          <ImpairmentField label="Jitter (ms)" value={jitter} onChange={setJitter} placeholder="0" />
          <ImpairmentField label="Loss (%)" value={loss} onChange={setLoss} placeholder="0" step="0.1" />
          <ImpairmentField label="Rate (kbit)" value={rate} onChange={setRate} placeholder="∞" />
          <ImpairmentField label="Corrupt (%)" value={corruption} onChange={setCorruption} placeholder="0" step="0.1" />
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={bothDirections}
            onChange={(e) => setBothDirections(e.target.checked)}
            className="accent-blue-500"
          />
          Both directions
        </label>

        {error && (
          <div className="text-[10px] text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={handleApply}
            disabled={loading}
            className="flex-1 px-3 py-1.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white text-xs font-medium rounded transition-colors"
          >
            {loading ? "Applying…" : "Apply"}
          </button>
          {existing && (
            <button
              onClick={handleClear}
              disabled={loading}
              className="flex-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 text-slate-700 text-xs font-medium rounded transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ImpairmentField({
  label,
  value,
  onChange,
  placeholder,
  step = "1",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  step?: string;
}) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">{label}</label>
      <input
        type="number"
        min="0"
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full text-xs font-mono px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
      />
    </div>
  );
}

// ── Interface Editor ──────────────────────────────────────────────────────────

function InterfaceEditor({
  node,
  ifaceName,
  iface,
  applyPatches,
  title,
}: {
  node: Node;
  ifaceName: string;
  iface: Interface;
  applyPatches: (patches: any[]) => void;
  title: string;
}) {
  const [ip, setIp] = useState(iface.ip ?? "");
  const [mac, setMac] = useState(iface.mac ?? "");

  useEffect(() => {
    setIp(iface.ip ?? "");
    setMac(iface.mac ?? "");
  }, [iface.ip, iface.mac]);

  const handleSave = () => {
    const ir = useTopologyStore.getState().ir;
    if (!ir) return;
    const nodeIndex = ir.topology.nodes.findIndex((n) => n.id === node.id);
    if (nodeIndex === -1) return;

    const patches = [];
    if (ip !== (iface.ip ?? "")) {
      patches.push({
        op: "replace",
        path: `/topology/nodes/${nodeIndex}/interfaces/${ifaceName}/ip`,
        value: ip,
      });
    }
    if (mac !== (iface.mac ?? "")) {
      patches.push({
        op: "replace",
        path: `/topology/nodes/${nodeIndex}/interfaces/${ifaceName}/mac`,
        value: mac,
      });
    }

    if (patches.length > 0) {
      applyPatches(patches);
    }
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded p-3">
      <div className="text-xs font-semibold text-slate-700 mb-2">{title}</div>
      <div className="text-[10px] text-slate-500 mb-3">
        {node.id} <span className="font-mono bg-slate-200 px-1 rounded">{ifaceName}</span>
      </div>

      <div className="space-y-2">
        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">IP Address</label>
          <input
            type="text"
            value={ip}
            onChange={(e) => setIp(e.target.value)}
            onBlur={handleSave}
            className="w-full text-xs font-mono px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="10.0.0.1/24"
          />
        </div>
        <div>
          <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">MAC Address</label>
          <input
            type="text"
            value={mac}
            onChange={(e) => setMac(e.target.value)}
            onBlur={handleSave}
            className="w-full text-xs font-mono px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
            placeholder="00:00:00:00:00:00"
          />
        </div>
      </div>
    </div>
  );
}
