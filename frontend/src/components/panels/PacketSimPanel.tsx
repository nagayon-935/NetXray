import { useMemo, useState } from "react";
import { useTopologyStore } from "../../stores/topology-store";
import { getEngine } from "../../engine/wasm-engine";
import type { PacketHeader } from "../../engine/types";
import { PanelFrame } from "./shared/PanelFrame";

function stripCidr(ip: string): string {
  return ip.split("/")[0];
}

export function PacketSimPanel() {
  const ir = useTopologyStore((s) => s.ir);
  const packetPath = useTopologyStore((s) => s.packetPath);
  const setPacketPath = useTopologyStore((s) => s.setPacketPath);
  const setActivePanel = useTopologyStore((s) => s.setActivePanel);

  const nodesWithIps = useMemo(() => {
    if (!ir) return [];
    return ir.topology.nodes
      .map((node) => ({
        node,
        ifaces: Object.entries(node.interfaces ?? {}).filter(
          (entry): entry is [string, typeof entry[1] & { ip: string }] => Boolean(entry[1].ip),
        ),
      }))
      .filter((entry) => entry.ifaces.length > 0);
  }, [ir]);

  const [srcNodeId, setSrcNodeId] = useState("");
  const [srcIface, setSrcIface] = useState("");
  const [dstNodeId, setDstNodeId] = useState("");
  const [dstIface, setDstIface] = useState("");
  const [protocol, setProtocol] = useState<PacketHeader["protocol"]>("tcp");
  const [dstPort, setDstPort] = useState("80");

  const srcIfaceOptions = nodesWithIps.find((e) => e.node.id === srcNodeId)?.ifaces ?? [];
  const dstIfaceOptions = nodesWithIps.find((e) => e.node.id === dstNodeId)?.ifaces ?? [];

  const handleSrcNodeChange = (nodeId: string) => {
    setSrcNodeId(nodeId);
    setSrcIface(nodesWithIps.find((e) => e.node.id === nodeId)?.ifaces[0]?.[0] ?? "");
  };

  const handleDstNodeChange = (nodeId: string) => {
    setDstNodeId(nodeId);
    setDstIface(nodesWithIps.find((e) => e.node.id === nodeId)?.ifaces[0]?.[0] ?? "");
  };

  const srcIp = srcIfaceOptions.find(([name]) => name === srcIface)?.[1].ip;
  const dstIp = dstIfaceOptions.find(([name]) => name === dstIface)?.[1].ip;

  const handleSimulate = () => {
    if (!ir || !srcIp || !dstIp) return;
    const packet: PacketHeader = {
      src_ip: stripCidr(srcIp),
      dst_ip: stripCidr(dstIp),
      protocol,
      dst_port: dstPort ? parseInt(dstPort, 10) : undefined,
    };
    const result = getEngine().simulatePacket(packet);
    setPacketPath(result);
  };

  const handleClear = () => {
    setPacketPath(null);
  };

  return (
    <PanelFrame title="Packet Simulation" onClose={() => setActivePanel(null)}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Source</label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={srcNodeId}
              onChange={(e) => handleSrcNodeChange(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
            >
              <option value="">Select node…</option>
              {nodesWithIps.map(({ node }) => (
                <option key={node.id} value={node.id}>
                  {node.hostname ?? node.id}
                </option>
              ))}
            </select>
            <select
              value={srcIface}
              onChange={(e) => setSrcIface(e.target.value)}
              disabled={!srcNodeId}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:border-blue-400 disabled:opacity-50"
            >
              {srcIfaceOptions.map(([name, iface]) => (
                <option key={name} value={name}>
                  {name} ({stripCidr(iface.ip)})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Destination</label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={dstNodeId}
              onChange={(e) => handleDstNodeChange(e.target.value)}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
            >
              <option value="">Select node…</option>
              {nodesWithIps.map(({ node }) => (
                <option key={node.id} value={node.id}>
                  {node.hostname ?? node.id}
                </option>
              ))}
            </select>
            <select
              value={dstIface}
              onChange={(e) => setDstIface(e.target.value)}
              disabled={!dstNodeId}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:border-blue-400 disabled:opacity-50"
            >
              {dstIfaceOptions.map(([name, iface]) => (
                <option key={name} value={name}>
                  {name} ({stripCidr(iface.ip)})
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Protocol</label>
            <select
              value={protocol}
              onChange={(e) => setProtocol(e.target.value as PacketHeader["protocol"])}
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 focus:outline-none focus:border-blue-400"
            >
              <option value="tcp">TCP</option>
              <option value="udp">UDP</option>
              <option value="icmp">ICMP</option>
              <option value="any">Any</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">Dst Port</label>
            <input
              type="number"
              value={dstPort}
              onChange={(e) => setDstPort(e.target.value)}
              placeholder="80"
              className="w-full text-xs border border-slate-200 rounded px-2 py-1.5 font-mono focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSimulate}
            disabled={!srcIp || !dstIp || !ir}
            className="flex-1 text-xs bg-blue-500 text-white rounded py-1.5 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Simulate
          </button>
          <button
            onClick={handleClear}
            className="text-xs bg-slate-100 text-slate-600 rounded px-3 py-1.5 hover:bg-slate-200"
          >
            Clear
          </button>
        </div>
      </div>

      {packetPath && (
        <div className="border-t border-slate-100 -mx-4 px-3 pt-3">
          <div className="flex items-center gap-2 mb-2">
            <span
              className={`text-xs font-semibold px-2 py-0.5 rounded ${
                packetPath.result === "delivered"
                  ? "bg-green-100 text-green-700"
                  : packetPath.result === "dropped"
                  ? "bg-red-100 text-red-700"
                  : "bg-yellow-100 text-yellow-700"
              }`}
            >
              {packetPath.result.toUpperCase()}
            </span>
            {packetPath.drop_reason && (
              <span className="text-xs text-slate-500">{packetPath.drop_reason}</span>
            )}
          </div>

          <div className="text-xs text-slate-500 uppercase tracking-wide mb-2">Path</div>
          <div className="space-y-1">
            {packetPath.hops.map((hop, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-slate-400 w-4 text-right">{i + 1}.</span>
                <div>
                  <span className="font-mono font-semibold text-slate-700">
                    {hop.node_id}
                  </span>
                  {hop.ingress_interface && (
                    <span className="text-slate-500 ml-1">in:{hop.ingress_interface}</span>
                  )}
                  {hop.egress_interface && (
                    <span className="text-slate-500 ml-1">out:{hop.egress_interface}</span>
                  )}
                  {hop.acl_result && (
                    <div
                      className={`mt-0.5 px-1.5 py-0.5 rounded inline-block ${
                        hop.acl_result.action === "permit"
                          ? "bg-green-50 text-green-700"
                          : hop.acl_result.action === "deny"
                          ? "bg-red-50 text-red-700"
                          : "bg-gray-50 text-gray-700"
                      }`}
                    >
                      {hop.acl_result.acl_name}: {hop.acl_result.action}
                      {hop.acl_result.matched_rule &&
                        ` (seq ${hop.acl_result.matched_rule.seq})`}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </PanelFrame>
  );
}
