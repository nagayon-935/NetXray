from typing import Any
from translator.parser_base import InterfaceData, AclRuleData

class BaseConfigGenerator:
    vendor_name: str = "base"

    def generate_interface_config(self, name: str, current: InterfaceData | None, desired: InterfaceData) -> list[str]:
        commands = [f"interface {name}"]

        # IP address
        if desired.get("ip"):
            commands.append(f" ip address {desired['ip']}")

        # Admin state
        if desired.get("state") == "down":
            commands.append(" shutdown")
        else:
            commands.append(" no shutdown")

        # Inbound ACL
        if desired.get("acl_in"):
            commands.append(f" ip access-group {desired['acl_in']} in")
        elif current and current.get("acl_in"):
            # ACL was removed — un-apply it
            commands.append(f" no ip access-group {current['acl_in']} in")

        # Outbound ACL
        if desired.get("acl_out"):
            commands.append(f" ip access-group {desired['acl_out']} out")
        elif current and current.get("acl_out"):
            commands.append(f" no ip access-group {current['acl_out']} out")

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

        # Interfaces are stored as a dict keyed by interface name in the IR
        # (e.g. { "eth0": { "ip": "...", "state": "up", ... } })
        base_ifaces: dict[str, Any] = base_node.get("interfaces") or {}
        target_ifaces: dict[str, Any] = target_node.get("interfaces") or {}

        # Normalise: handle legacy list-of-dicts format too
        if isinstance(base_ifaces, list):
            base_ifaces = {i["name"]: i for i in base_ifaces if "name" in i}
        if isinstance(target_ifaces, list):
            target_ifaces = {i["name"]: i for i in target_ifaces if "name" in i}

        for name, target_iface in target_ifaces.items():
            base_iface = base_ifaces.get(name)
            if base_iface != target_iface:
                commands.extend(self.generate_interface_config(name, base_iface, target_iface))

        # BGP diff
        base_bgp = base_node.get("bgp")
        target_bgp = target_node.get("bgp")
        if target_bgp and base_bgp != target_bgp:
            commands.extend(self.generate_bgp_config(target_bgp))

        commands.extend(end_cmds)
        return commands
