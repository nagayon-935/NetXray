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
        # If node_name is present, use docker exec directly.
        # This is more reliable than containerlab exec in various environments.
        if node_name:
            import subprocess
            results = {}
            for cmd in _COMMANDS:
                try:
                    # Run via docker exec on the host (NetXray container has docker CLI + socket)
                    full_cmd = ["docker", "exec", node_name, "sh", "-c", cmd]
                    res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=10, check=True)
                    results[cmd] = res.stdout
                except Exception as e:
                    results[cmd] = f"ERROR: {str(e)}"
            raw = results
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
