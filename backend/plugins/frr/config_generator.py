from typing import Any
from plugins.base_config_generator import BaseConfigGenerator

class FrrConfigGenerator(BaseConfigGenerator):
    vendor_name = "frr"

    def generate_bgp_config(self, bgp: dict[str, Any]) -> list[str]:
        asn = bgp.get("asn")
        if not asn:
            return []
        commands = [f"router bgp {asn}"]
        router_id = bgp.get("router_id")
        if router_id:
            commands.append(f" bgp router-id {router_id}")
        
        for neighbor in bgp.get("neighbors", []):
            peer_ip = neighbor.get("ip")
            remote_as = neighbor.get("remote_as")
            if peer_ip and remote_as:
                commands.append(f" neighbor {peer_ip} remote-as {remote_as}")
                if neighbor.get("description"):
                    commands.append(f" neighbor {peer_ip} description {neighbor['description']}")
        
        return commands

    def generate_full_diff(self, base_node: dict[str, Any], target_node: dict[str, Any]) -> list[str]:
        """Simple diff generator for Demo purposes."""
        return self._generate_full_diff_template(
            base_node, 
            target_node, 
            start_cmds=["conf t"], 
            end_cmds=["end", "write memory"]
        )
