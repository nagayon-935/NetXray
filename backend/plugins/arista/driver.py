"""Arista EOS driver — eAPI (preferred) with SSH fallback."""

import json
import logging

import httpx

logger = logging.getLogger(__name__)

_EAPI_COMMANDS = [
    "show interfaces",
    "show ip route",
    "show ip route vrf all",
    "show ip access-lists",
]

_SSH_COMMANDS = [f"{cmd} | json" for cmd in _EAPI_COMMANDS]
_SSH_KEY_MAP = {f"{cmd} | json": cmd for cmd in _EAPI_COMMANDS}


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
        payload = {
            "jsonrpc": "2.0",
            "method": "runCmds",
            "params": {"version": 1, "cmds": _EAPI_COMMANDS, "format": "json"},
            "id": "netxray-1",
        }
        resp = httpx.post(
            url,
            json=payload,
            auth=(username, password),
            verify=False,
            timeout=30.0,
        )
        resp.raise_for_status()
        result = resp.json()
        if "error" in result:
            raise RuntimeError(f"eAPI error: {result['error']}")

        outputs: dict[str, str] = {}
        for cmd, cmd_result in zip(_EAPI_COMMANDS, result.get("result", [])):
            outputs[cmd] = json.dumps(cmd_result)
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
