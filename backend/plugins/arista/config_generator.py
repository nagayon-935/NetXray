from typing import Any
from backend.plugins.base_config_generator import BaseConfigGenerator

class AristaConfigGenerator(BaseConfigGenerator):
    vendor_name = "arista"

    def generate_bgp_config(self, bgp: dict[str, Any]) -> list[str]:
        asn = bgp.get("asn")
        if not asn:
            return []
        commands = [f"router bgp {asn}"]
        router_id = bgp.get("router_id")
        if router_id:
            commands.append(f" router-id {router_id}")
        
        for neighbor in bgp.get("neighbors", []):
            peer_ip = neighbor.get("ip")
            remote_as = neighbor.get("remote_as")
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
