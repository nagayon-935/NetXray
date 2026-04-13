from typing import Any
from backend.translator.parser_base import InterfaceData, AclRuleData

class BaseConfigGenerator:
    vendor_name: str = "base"

    def generate_interface_config(self, name: str, current: InterfaceData | None, desired: InterfaceData) -> list[str]:
        commands = [f"interface {name}"]
        if desired.get("ip"):
            commands.append(f" ip address {desired['ip']}")
        if desired.get("state") == "down":
            commands.append(" shutdown")
        else:
            commands.append(" no shutdown")
        
        if desired.get("acl_in"):
            commands.append(f" ip access-group {desired['acl_in']} in")
        
        return commands

    def generate_acl_config(self, acl_name: str, rules: list[AclRuleData]) -> list[str]:
        commands = [f"ip access-list {acl_name}"]
        for rule in rules:
            line = f" {rule['seq']} {rule['action']} {rule['protocol']} {rule['src']} {rule['dst']}"
            if rule.get("dst_port"):
                line += f" eq {rule['dst_port']}"
            commands.append(line)
        return commands

    def generate_bgp_config(self, bgp: dict[str, Any]) -> list[str]:
        # Subclasses should override this or call super if needed
        return []

    def _generate_full_diff_template(self, base_node: dict[str, Any], target_node: dict[str, Any], start_cmds: list[str], end_cmds: list[str]) -> list[str]:
        commands = list(start_cmds)
        
        # Interfaces diff
        base_ifaces = {iface["name"]: iface for iface in base_node.get("interfaces", [])}
        target_ifaces = {iface["name"]: iface for iface in target_node.get("interfaces", [])}
        
        for name, target_iface in target_ifaces.items():
            base_iface = base_ifaces.get(name)
            if base_iface != target_iface:
                commands.extend(self.generate_interface_config(name, base_iface, target_iface))
        
        # ACL diff
        base_acls = base_node.get("acls", {})
        target_acls = target_node.get("acls", {})
        for name, rules in target_acls.items():
            if base_acls.get(name) != rules:
                commands.extend(self.generate_acl_config(name, rules))
        
        commands.extend(end_cmds)
        return commands
