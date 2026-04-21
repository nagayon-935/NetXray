import { useState, useRef } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { PanelFrame } from "./shared/PanelFrame";
import type { Node } from "../../types/netxray-ir";

export function NodeEditPanel() {
  const ir = useTopologyStore((s) => s.ir);
  const selectedNodeId = useTopologyStore((s) => s.selectedNodeId);
  const updateNode = useTopologyStore((s) => s.updateNode);
  const deleteNode = useTopologyStore((s) => s.deleteNode);
  const closePanel = () => useTopologyStore.getState().setActivePanel(null);

  if (!ir || !selectedNodeId) return null;

  const node = ir.topology.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  return (
    <PanelFrame title="Edit Node" onClose={closePanel}>
      <div className="text-[10px] text-slate-400 font-mono -mt-2">{node.id}</div>
      {/* key={node.id} causes remount so child state resets when selection changes */}
      <NodeBasicEditor key={`basic-${node.id}`} node={node} updateNode={updateNode} />
      <InterfacesEditor key={`ifaces-${node.id}`} node={node} updateNode={updateNode} />
      <BgpEditor key={`bgp-${node.id}`} node={node} updateNode={updateNode} />
      <RawConfigEditor key={`cfg-${node.id}`} node={node} updateNode={updateNode} />
      <div className="p-3 border-t border-slate-100">
        <button
          onClick={() => deleteNode(node.id)}
          className="w-full px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 text-xs font-medium rounded border border-red-200 transition-colors"
        >
          Delete Node
        </button>
      </div>
    </PanelFrame>
  );
}

// ── Basic fields ──────────────────────────────────────────────────────────────

function NodeBasicEditor({
  node,
  updateNode,
}: {
  node: Node;
  updateNode: (id: string, patch: Partial<Node>) => void;
}) {
  const [hostname, setHostname] = useState(node.hostname ?? "");
  const [vendor, setVendor] = useState<"frr" | "arista" | "generic">(node.vendor ?? "generic");

  const save = () => {
    const patch: Partial<Node> = {};
    if (hostname !== (node.hostname ?? "")) patch.hostname = hostname || undefined;
    if (vendor !== (node.vendor ?? "generic")) patch.vendor = vendor;
    if (Object.keys(patch).length) updateNode(node.id, patch);
  };

  return (
    <div className="p-3 border-b border-slate-100 space-y-2">
      <div>
        <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">Hostname</label>
        <input
          type="text"
          value={hostname}
          onChange={(e) => setHostname(e.target.value)}
          onBlur={save}
          className="w-full text-xs font-mono px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          placeholder={node.id}
        />
      </div>
      <div>
        <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">Vendor</label>
        <select
          value={vendor}
          onChange={(e) => setVendor(e.target.value as typeof vendor)}
          onBlur={save}
          className="w-full text-xs px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        >
          {(["generic", "frr", "arista"] as const).map((v) => (
            <option key={v} value={v}>{v}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ── Interfaces ────────────────────────────────────────────────────────────────

function InterfacesEditor({
  node,
  updateNode,
}: {
  node: Node;
  updateNode: (id: string, patch: Partial<Node>) => void;
}) {
  const ifaces = node.interfaces ?? {};
  const [newName, setNewName] = useState("");

  const setIfaceField = (name: string, field: "ip" | "state", value: string) => {
    const existing = ifaces[name] ?? { state: "up" as const };
    const updated = field === "ip"
      ? { ...existing, ip: value || undefined }
      : { ...existing, state: value as "up" | "down" };
    updateNode(node.id, { interfaces: { ...ifaces, [name]: updated } });
  };

  const addIface = () => {
    const n = newName.trim();
    if (!n || ifaces[n]) return;
    updateNode(node.id, { interfaces: { ...ifaces, [n]: { state: "up" as const } } });
    setNewName("");
  };

  const removeIface = (name: string) => {
    const next = { ...ifaces };
    delete next[name];
    updateNode(node.id, { interfaces: next });
  };

  return (
    <div className="p-3 border-b border-slate-100">
      <div className="text-xs font-semibold text-slate-700 mb-2">Interfaces</div>
      <div className="space-y-2">
        {Object.entries(ifaces).map(([name, iface]) => (
          <div key={name} className="bg-slate-50 border border-slate-200 rounded p-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono font-bold text-slate-600">{name}</span>
              <button onClick={() => removeIface(name)} className="text-[10px] text-red-400 hover:text-red-600">
                ✕
              </button>
            </div>
            <div className="space-y-1">
              <input
                type="text"
                defaultValue={iface.ip ?? ""}
                onBlur={(e) => setIfaceField(name, "ip", e.target.value)}
                placeholder="IP (e.g. 10.0.0.1/24)"
                className="w-full text-[10px] font-mono px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <select
                value={iface.state ?? "up"}
                onChange={(e) => setIfaceField(name, "state", e.target.value)}
                className="w-full text-[10px] px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="up">up</option>
                <option value="down">down</option>
              </select>
            </div>
          </div>
        ))}
        <div className="flex gap-1">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addIface()}
            placeholder="New interface name"
            className="flex-1 text-[10px] font-mono px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <button onClick={addIface} className="px-2 py-1 bg-blue-500 text-white text-[10px] rounded hover:bg-blue-600">
            +
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Raw Config ────────────────────────────────────────────────────────────────

function RawConfigEditor({
  node,
  updateNode,
}: {
  node: Node;
  updateNode: (id: string, patch: Partial<Node>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(node.raw_config ?? "");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  const canGenerate = node.vendor === "frr" || node.vendor === "arista";

  const save = () => {
    updateNode(node.id, { raw_config: config || undefined });
  };

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/iac/config/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ node, vendor: node.vendor ?? "generic" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail ?? res.statusText);
      }
      const { config: generated } = await res.json();
      setConfig(generated);
      updateNode(node.id, { raw_config: generated });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="border-b border-slate-100">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
      >
        <span>Raw Config</span>
        <span className="text-slate-400">{open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-2">
          {error && (
            <div className="text-[10px] text-red-500 bg-red-50 border border-red-200 rounded px-2 py-1">
              {error}
            </div>
          )}
          <textarea
            ref={textRef}
            value={config}
            onChange={(e) => setConfig(e.target.value)}
            onBlur={save}
            rows={10}
            className="w-full text-[10px] font-mono px-2 py-1.5 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y"
            placeholder="Paste or generate startup config…"
          />
          <div className="flex gap-1.5">
            {canGenerate && (
              <button
                onClick={generate}
                disabled={generating}
                className="flex-1 px-2 py-1 bg-blue-50 hover:bg-blue-100 text-blue-600 text-[10px] font-medium rounded border border-blue-200 transition-colors disabled:opacity-50"
              >
                {generating ? "Generating…" : "⚡ Generate Config"}
              </button>
            )}
            <button
              onClick={save}
              className="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-600 text-[10px] font-medium rounded border border-slate-200 transition-colors"
            >
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── BGP ───────────────────────────────────────────────────────────────────────

function BgpEditor({
  node,
  updateNode,
}: {
  node: Node;
  updateNode: (id: string, patch: Partial<Node>) => void;
}) {
  const [localAs, setLocalAs] = useState(node.bgp?.local_as?.toString() ?? "");

  const save = () => {
    const as = parseInt(localAs, 10);
    if (localAs === "" && node.bgp) {
      updateNode(node.id, { bgp: undefined });
    } else if (!isNaN(as) && as !== node.bgp?.local_as) {
      updateNode(node.id, { bgp: { router_id: node.bgp?.router_id ?? "", ...node.bgp, local_as: as } });
    }
  };

  return (
    <div className="p-3 border-b border-slate-100">
      <div className="text-xs font-semibold text-slate-700 mb-2">BGP</div>
      <div>
        <label className="block text-[10px] text-slate-500 uppercase tracking-wide mb-1">Local AS</label>
        <input
          type="number"
          min="1"
          value={localAs}
          onChange={(e) => setLocalAs(e.target.value)}
          onBlur={save}
          placeholder="(none)"
          className="w-full text-xs font-mono px-2 py-1 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>
    </div>
  );
}
