from typing import Any
from plugins.base_config_generator import BaseConfigGenerator


class AristaConfigGenerator(BaseConfigGenerator):
    vendor_name = "arista"

    def generate_startup_config(self, node: dict[str, Any]) -> str:
        """Emit an Arista EOS-style configuration from an IR node dict."""
        lines: list[str] = []
        hostname = node.get("hostname") or node.get("id") or "router"
        lines += [f"hostname {hostname}", "!"]

        for iface_name, iface in (node.get("interfaces") or {}).items():
            lines.append(f"interface {iface_name}")
            if iface.get("ip"):
                lines.append(f"   ip address {iface['ip']}")
            if iface.get("state") == "down":
                lines.append("   shutdown")
            else:
                lines.append("   no shutdown")
            lines.append("!")

        bgp = node.get("bgp")
        if bgp:
            lines.extend(self.generate_bgp_config(bgp))
            lines.append("!")

        ospf = node.get("ospf")
        if ospf:
            lines.extend(self._generate_ospf_config(ospf))
            lines.append("!")

        lines.append("end")
        return "\n".join(lines) + "\n"

    def _generate_ospf_config(self, ospf: dict[str, Any]) -> list[str]:
        router_id = ospf.get("router_id", "")
        lines = ["router ospf 1"]
        if router_id:
            lines.append(f"   router-id {router_id}")
        for net in ospf.get("networks", []):
            area = net.get("area", "0.0.0.0")
            prefix = net.get("network") or net.get("prefix")
            if prefix:
                lines.append(f"   network {prefix} area {area}")
        return lines

    def generate_bgp_config(self, bgp: dict[str, Any]) -> list[str]:
        # IR uses local_as; fall back to legacy asn key for compatibility
        asn = bgp.get("local_as") or bgp.get("asn")
        if not asn:
            return []
        commands = [f"router bgp {asn}"]
        router_id = bgp.get("router_id")
        if router_id:
            commands.append(f" router-id {router_id}")  # Arista style — no "bgp" prefix

        # sessions[] is the IR format; neighbors[] is the legacy format
        peers = bgp.get("sessions") or bgp.get("neighbors", [])
        for peer in peers:
            peer_ip = peer.get("peer_ip") or peer.get("ip")
            remote_as = peer.get("remote_as")
            if peer_ip and remote_as:
                commands.append(f" neighbor {peer_ip} remote-as {remote_as}")

        return commands

    def generate_full_diff(self, base_node: dict[str, Any], target_node: dict[str, Any]) -> list[str]:
        return self._generate_full_diff_template(
            base_node, 
            target_node, 
            start_cmds=["configure terminal"], 
            end_cmds=["end", "copy running-config startup-config"]
        )
