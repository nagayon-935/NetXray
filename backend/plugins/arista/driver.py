"""Arista EOS driver — eAPI (preferred) with SSH fallback."""

import json
import logging

import httpx

logger = logging.getLogger(__name__)

_JSON_COMMANDS = [
    "show interfaces",
    "show ip route",
    "show ip route vrf all",
    "show ip access-lists",
]

# running-config must be collected as text
_TEXT_COMMANDS = [
    "show running-config",
]

_EAPI_COMMANDS = _JSON_COMMANDS + _TEXT_COMMANDS

_SSH_COMMANDS = [f"{cmd} | json" for cmd in _JSON_COMMANDS] + _TEXT_COMMANDS
_SSH_KEY_MAP = {f"{cmd} | json": cmd for cmd in _JSON_COMMANDS}
_SSH_KEY_MAP.update({cmd: cmd for cmd in _TEXT_COMMANDS})


class AristaDriver:
    @classmethod
    def vendor_name(cls) -> str:
        return "arista"

    def collect(
        self, host: str, credentials: dict[str, str], node_name: str | None = None
    ) -> dict[str, str]:
        username = credentials.get("username", "admin")
        password = credentials.get("password", "")
        eapi_port = int(credentials.get("eapi_port", 443))

        try:
            return self._collect_eapi(host, eapi_port, username, password)
        except Exception as exc:
            logger.warning("eAPI failed for %s (%s), falling back to SSH", host, exc)
            return self._collect_ssh(host, credentials)

    def _collect_eapi(self, host: str, port: int, username: str, password: str) -> dict[str, str]:
        url = f"https://{host}:{port}/command-api"
        outputs: dict[str, str] = {}

        # JSON-format commands
        payload = {
            "jsonrpc": "2.0",
            "method": "runCmds",
            "params": {"version": 1, "cmds": _JSON_COMMANDS, "format": "json"},
            "id": "netxray-1",
        }
        resp = httpx.post(url, json=payload, auth=(username, password), verify=False, timeout=30.0)
        resp.raise_for_status()
        result = resp.json()
        if "error" in result:
            raise RuntimeError(f"eAPI error: {result['error']}")
        for cmd, cmd_result in zip(_JSON_COMMANDS, result.get("result", [])):
            outputs[cmd] = json.dumps(cmd_result)

        # Text-format commands (running-config)
        payload_text = {
            "jsonrpc": "2.0",
            "method": "runCmds",
            "params": {"version": 1, "cmds": _TEXT_COMMANDS, "format": "text"},
            "id": "netxray-2",
        }
        resp = httpx.post(url, json=payload_text, auth=(username, password), verify=False, timeout=30.0)
        resp.raise_for_status()
        result = resp.json()
        if "error" in result:
            raise RuntimeError(f"eAPI error: {result['error']}")
        for cmd, cmd_result in zip(_TEXT_COMMANDS, result.get("result", [])):
            outputs[cmd] = cmd_result.get("output", "") if isinstance(cmd_result, dict) else ""

        return outputs

    def _collect_ssh(self, host: str, credentials: dict[str, str]) -> dict[str, str]:
        from collector import ssh_client

        username = credentials.get("username", "admin")
        password = credentials.get("password", "")
        port = int(credentials.get("port", 22))

        raw = ssh_client.execute_commands(
            host=host,
            port=port,
            username=username,
            password=password,
            device_type="arista_eos",
            commands=_SSH_COMMANDS,
        )
        return {_SSH_KEY_MAP[cmd]: output for cmd, output in raw.items()}
