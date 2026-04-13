import { useState, useMemo } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { detectBgpRoleMismatches, type BgpRoleMismatch } from "../../lib/bgp-overlay";
import type { Node, BgpSession, Srv6Sid, Vni } from "../../types/netxray-ir";

// ─── Color maps ─────────────────────────────────────────────────────────────

const protocolColors: Record<string, string> = {
  bgp: "bg-blue-100 text-blue-800",
  ospf: "bg-green-100 text-green-800",
  connected: "bg-gray-100 text-gray-700",
  static: "bg-yellow-100 text-yellow-800",
};

const bgpStateColors: Record<string, string> = {
  established: "bg-emerald-100 text-emerald-700",
  idle: "bg-amber-100 text-amber-700",
  active: "bg-orange-100 text-orange-700",
  connect: "bg-orange-100 text-orange-700",
  opensent: "bg-sky-100 text-sky-700",
  openconfirm: "bg-sky-100 text-sky-700",
  unknown: "bg-gray-100 text-gray-500",
};

const roleColors: Record<string, string> = {
  provider: "bg-purple-100 text-purple-700",
  customer: "bg-pink-100 text-pink-700",
  rs: "bg-blue-100 text-blue-700",
  "rs-client": "bg-cyan-100 text-cyan-700",
  peer: "bg-slate-100 text-slate-600",
  undefined: "bg-gray-100 text-gray-400",
};

// ─── Tab type ────────────────────────────────────────────────────────────────

type Tab = "general" | "bgp" | "srv6" | "evpn";

// ─── Sub-panels ──────────────────────────────────────────────────────────────

function GeneralTab({ node }: { node: Node }) {
  return (
    <>
      <div className="p-3 border-b border-slate-100">
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Info</div>
        <div className="grid grid-cols-2 gap-1 text-xs">
          <span className="text-slate-500">Type</span>
          <span className="text-slate-800">{node.type}</span>
          <span className="text-slate-500">Vendor</span>
          <span className="text-slate-800">{node.vendor ?? "generic"}</span>
          <span className="text-slate-500">ID</span>
          <span className="text-slate-800 font-mono">{node.id}</span>
        </div>
      </div>

      {node.interfaces && (
        <div className="p-3 border-b border-slate-100">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Interfaces</div>
          <div className="space-y-1">
            {Object.entries(node.interfaces).map(([name, iface]) => (
              <div
                key={name}
                className="flex items-center justify-between text-xs bg-slate-50 rounded px-2 py-1"
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      iface.state === "up" ? "bg-green-400" : "bg-red-400"
                    }`}
                  />
                  <span className="font-mono text-slate-700">{name}</span>
                </div>
                <span className="text-slate-500 font-mono text-[10px]">{iface.ip ?? "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {node.vrfs &&
        Object.entries(node.vrfs).map(([vrfName, vrf]) => (
          <div key={vrfName} className="p-3 border-b border-slate-100">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">
              Routes — VRF: {vrfName}
            </div>
            {vrf.routing_table && vrf.routing_table.length > 0 ? (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500">
                    <th className="pb-1 font-medium">Prefix</th>
                    <th className="pb-1 font-medium">Next Hop</th>
                    <th className="pb-1 font-medium">Proto</th>
                  </tr>
                </thead>
                <tbody>
                  {vrf.routing_table.map((route) => (
                    <tr key={route.prefix} className="border-t border-slate-50">
                      <td className="py-0.5 font-mono text-slate-700 text-[10px]">
                        {route.prefix}
                      </td>
                      <td className="py-0.5 font-mono text-slate-600 text-[10px]">
                        {route.next_hop === "0.0.0.0" || route.next_hop === null
                          ? "direct"
                          : route.next_hop}
                      </td>
                      <td className="py-0.5">
                        <span
                          className={`px-1 rounded text-[9px] ${
                            protocolColors[route.protocol] ?? ""
                          }`}
                        >
                          {route.protocol}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="text-xs text-slate-400">No routes</div>
            )}
          </div>
        ))}

      {node.interfaces &&
        Object.entries(node.interfaces).some(([, iface]) => iface.acl_in || iface.acl_out) && (
          <div className="p-3">
            <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Applied ACLs</div>
            {Object.entries(node.interfaces)
              .filter(([, iface]) => iface.acl_in || iface.acl_out)
              .map(([name, iface]) => (
                <div key={name} className="text-xs mb-1">
                  <span className="font-mono text-slate-600">{name}:</span>
                  {iface.acl_in && (
                    <span className="ml-2 text-orange-600">in={iface.acl_in}</span>
                  )}
                  {iface.acl_out && (
                    <span className="ml-2 text-blue-600">out={iface.acl_out}</span>
                  )}
                </div>
              ))}
          </div>
        )}
    </>
  );
}

function BgpTab({
  node,
  mismatches,
}: {
  node: Node;
  mismatches: BgpRoleMismatch[];
}) {
  const bgp = node.bgp;
  if (!bgp) return null;

  return (
    <div className="p-3">
      <div className="mb-3">
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">BGP Config</div>
        <div className="grid grid-cols-2 gap-1 text-xs bg-slate-50 rounded px-2 py-1.5">
          <span className="text-slate-500">Local AS</span>
          <span className="font-mono text-slate-800">{bgp.local_as}</span>
          <span className="text-slate-500">Router-ID</span>
          <span className="font-mono text-slate-800">{bgp.router_id}</span>
        </div>
      </div>

      {mismatches.length > 0 && (
        <div className="mb-3 space-y-1">
          {mismatches.map((m, i) => (
            <div
              key={i}
              className="text-[10px] bg-red-50 border border-red-200 rounded px-2 py-1.5"
            >
              <span className="font-semibold text-red-700">⚠ Role Mismatch</span>
              <span className="text-red-600 ml-1">
                with {m.targetNode === node.id ? m.sourceNode : m.targetNode}:
                expected <code className="bg-red-100 px-0.5 rounded">{m.expectedTargetRole}</code>,
                got <code className="bg-red-100 px-0.5 rounded">{m.actualTargetRole}</code>
              </span>
            </div>
          ))}
        </div>
      )}

      {bgp.sessions && bgp.sessions.length > 0 ? (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">
            Sessions ({bgp.sessions.length})
          </div>
          <div className="space-y-1.5">
            {bgp.sessions.map((session: BgpSession) => {
              // Only highlight sessions that are part of a mismatch involving THIS node
              const peerInMismatch = mismatches.some(
                (m) =>
                  (m.sourceNode === node.id && m.targetNode === session.peer_node) ||
                  (m.targetNode === node.id && m.sourceNode === session.peer_node)
              );
              return (
                <div
                  key={session.peer_ip}
                  className={`rounded border text-xs px-2 py-1.5 ${
                    peerInMismatch
                      ? "border-red-200 bg-red-50"
                      : "border-slate-100 bg-slate-50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-slate-700">{session.peer_ip}</span>
                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                        bgpStateColors[session.state] ?? bgpStateColors.unknown
                      }`}
                    >
                      {session.state}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="text-slate-500">
                      AS{session.remote_as}
                      {session.peer_node && (
                        <span className="ml-1 text-slate-400">({session.peer_node})</span>
                      )}
                    </span>
                    {session.role && (
                      <span
                        className={`px-1 py-0.5 rounded text-[9px] ${
                          roleColors[session.role] ?? "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {session.role}
                      </span>
                    )}
                  </div>
                  {session.address_families && session.address_families.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {session.address_families.map((af) => (
                        <span
                          key={af}
                          className="text-[9px] px-1 bg-slate-200 text-slate-600 rounded"
                        >
                          {af}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-400">No BGP sessions configured</div>
      )}
    </div>
  );
}

function Srv6Tab({ node }: { node: Node }) {
  const srv6 = node.srv6;
  if (!srv6) return null;

  return (
    <div className="p-3">
      <div className="mb-3">
        <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">Locator</div>
        <div className="font-mono text-sm text-purple-700 bg-purple-50 rounded px-2 py-1.5">
          {srv6.locator}
        </div>
      </div>

      {srv6.sids && srv6.sids.length > 0 ? (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">
            SID Table ({srv6.sids.length})
          </div>
          <div className="space-y-1">
            {srv6.sids.map((sid: Srv6Sid) => (
              <div
                key={sid.sid}
                className="border border-slate-100 rounded px-2 py-1.5 bg-slate-50 text-xs"
              >
                <div className="font-mono text-purple-800 text-[10px] break-all mb-0.5">
                  {sid.sid}
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-1 py-0.5 bg-purple-100 text-purple-700 rounded text-[9px] font-medium">
                    {sid.function}
                  </span>
                  {sid.vrf && (
                    <span className="text-slate-500 text-[10px]">VRF: {sid.vrf}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-400">No SIDs configured</div>
      )}
    </div>
  );
}

function EvpnTab({ node }: { node: Node }) {
  const evpn = node.evpn;
  if (!evpn) return null;

  return (
    <div className="p-3">
      {evpn.vtep_ip && (
        <div className="mb-3">
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-1">VTEP</div>
          <div className="font-mono text-sm text-cyan-700 bg-cyan-50 rounded px-2 py-1.5">
            {evpn.vtep_ip}
          </div>
        </div>
      )}

      {evpn.vnis && evpn.vnis.length > 0 ? (
        <div>
          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">
            VNI Table ({evpn.vnis.length})
          </div>
          <div className="space-y-1.5">
            {evpn.vnis.map((vni: Vni) => (
              <div
                key={String(vni.vni)}
                className="border border-slate-100 rounded px-2 py-1.5 bg-slate-50 text-xs"
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="font-mono font-semibold text-cyan-800">VNI {vni.vni}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${
                      vni.type === "L2"
                        ? "bg-cyan-100 text-cyan-700"
                        : "bg-indigo-100 text-indigo-700"
                    }`}
                  >
                    {vni.type}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 space-y-0.5">
                  {vni.vlan != null && <div>VLAN: {vni.vlan}</div>}
                  {vni.rd && (
                    <div>
                      RD: <span className="font-mono">{vni.rd}</span>
                    </div>
                  )}
                  {vni.rt_import && vni.rt_import.length > 0 && (
                    <div>
                      Import RT: <span className="font-mono">{vni.rt_import.join(", ")}</span>
                    </div>
                  )}
                  {vni.rt_export && vni.rt_export.length > 0 && (
                    <div>
                      Export RT: <span className="font-mono">{vni.rt_export.join(", ")}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-xs text-slate-400">No VNIs configured</div>
      )}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function NodeDetailPanel() {
  const ir = useTopologyStore((s) => s.ir);
  const selectedNodeId = useTopologyStore((s) => s.selectedNodeId);
  const selectNode = useTopologyStore((s) => s.selectNode);
  const [activeTab, setActiveTab] = useState<Tab>("general");

  // All hooks MUST come before any early returns (Rules of Hooks)
  const allMismatches = useMemo(
    () => (ir ? detectBgpRoleMismatches(ir) : []),
    [ir]
  );

  if (!ir || !selectedNodeId) return null;

  const node = ir.topology.nodes.find((n) => n.id === selectedNodeId);
  if (!node) return null;

  const nodeMismatches = allMismatches.filter(
    (m) => m.sourceNode === node.id || m.targetNode === node.id
  );

  const hasBgp = !!node.bgp;
  const hasSrv6 = !!node.srv6;
  const hasEvpn = !!node.evpn;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "general", label: "General" },
    ...(hasBgp
      ? [{ id: "bgp" as Tab, label: "BGP", badge: nodeMismatches.length || undefined }]
      : []),
    ...(hasSrv6 ? [{ id: "srv6" as Tab, label: "SRv6" }] : []),
    ...(hasEvpn ? [{ id: "evpn" as Tab, label: "EVPN" }] : []),
  ];

  // Reset to "general" if current tab no longer exists
  const currentTab = tabs.find((t) => t.id === activeTab) ? activeTab : "general";

  return (
    <div className="w-80 bg-white border-l border-slate-200 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 bg-slate-50 flex-shrink-0">
        <h2 className="font-semibold text-sm text-slate-800 truncate">
          {node.hostname || node.id}
        </h2>
        <button
          onClick={() => selectNode(null)}
          className="text-slate-400 hover:text-slate-600 text-lg leading-none ml-2"
          aria-label="Close"
        >
          ×
        </button>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-slate-200 bg-slate-50 flex-shrink-0 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 text-xs font-medium flex items-center gap-1 border-b-2 whitespace-nowrap transition-colors ${
              currentTab === tab.id
                ? "border-blue-500 text-blue-600 bg-white"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {tab.label}
            {tab.badge ? (
              <span className="ml-0.5 w-4 h-4 flex items-center justify-center text-[9px] bg-red-500 text-white rounded-full leading-none">
                {tab.badge}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="overflow-y-auto flex-1">
        {currentTab === "general" && <GeneralTab node={node} />}
        {currentTab === "bgp" && <BgpTab node={node} mismatches={nodeMismatches} />}
        {currentTab === "srv6" && <Srv6Tab node={node} />}
        {currentTab === "evpn" && <EvpnTab node={node} />}
      </div>
    </div>
  );
}
