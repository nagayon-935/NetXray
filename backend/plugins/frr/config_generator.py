from typing import Any
from plugins.base_config_generator import BaseConfigGenerator

class FrrConfigGenerator(BaseConfigGenerator):
    vendor_name = "frr"

    def generate_bgp_config(self, bgp: dict[str, Any]) -> list[str]:
        # IR uses local_as; fall back to legacy asn key for compatibility
        asn = bgp.get("local_as") or bgp.get("asn")
        if not asn:
            return []
        commands = [f"router bgp {asn}"]
        router_id = bgp.get("router_id")
        if router_id:
            commands.append(f" bgp router-id {router_id}")

        # sessions[] is the IR format; neighbors[] is the legacy format
        peers = bgp.get("sessions") or bgp.get("neighbors", [])
        for peer in peers:
            peer_ip = peer.get("peer_ip") or peer.get("ip")
            remote_as = peer.get("remote_as")
            if peer_ip and remote_as:
                commands.append(f" neighbor {peer_ip} remote-as {remote_as}")
                if peer.get("description"):
                    commands.append(f" neighbor {peer_ip} description {peer['description']}")

        return commands

    def generate_full_diff(self, base_node: dict[str, Any], target_node: dict[str, Any]) -> list[str]:
        """Simple diff generator for Demo purposes."""
        return self._generate_full_diff_template(
            base_node, 
            target_node, 
            start_cmds=["conf t"], 
            end_cmds=["end", "write memory"]
        )
