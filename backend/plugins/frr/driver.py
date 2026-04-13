"""FRR driver — connects via SSH (linux device_type) and runs vtysh commands."""

import logging

from collector import ssh_client

logger = logging.getLogger(__name__)

_COMMANDS = [
    'vtysh -c "show interface json"',
    'vtysh -c "show ip route json"',
    'vtysh -c "show ip route vrf all json"',
    'vtysh -c "show ip bgp json"',
    'vtysh -c "show running-config"',
]

# Map vtysh command -> parser key expected by FrrParser
_CMD_KEY_MAP = {
    'vtysh -c "show interface json"': "show interface json",
    'vtysh -c "show ip route json"': "show ip route json",
    'vtysh -c "show ip route vrf all json"': "show ip route vrf all json",
    'vtysh -c "show ip bgp json"': "show ip bgp json",
    'vtysh -c "show running-config"': "show running-config",
}


class FrrDriver:
    @classmethod
    def vendor_name(cls) -> str:
        return "frr"

    def collect(
        self, host: str, credentials: dict[str, str], node_name: str | None = None
    ) -> dict[str, str]:
        # If node_name is present, prefer clab exec over SSH (common for clab FRR).
        if node_name:
            from collector.clab import exec_node

            raw = exec_node(node_name, _COMMANDS)
        else:
            username = credentials.get("username", "admin")
            password = credentials.get("password", "admin")
            port = int(credentials.get("port", 22))

            raw = ssh_client.execute_commands(
                host=host,
                port=port,
                username=username,
                password=password,
                device_type="linux",
                commands=_COMMANDS,
            )

        # Remap keys to parser-expected names
        return {_CMD_KEY_MAP[cmd]: output for cmd, output in raw.items()}
