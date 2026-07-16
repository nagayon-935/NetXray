import subprocess
import logging

logger = logging.getLogger(__name__)

_COMMANDS = [
    "ip -j addr",
    "ip -j route",
]

class GenericDriver:
    @classmethod
    def vendor_name(cls) -> str:
        return "generic"

    def collect(self, host: str, credentials: dict[str, str], node_name: str | None = None) -> dict[str, str]:
        if not node_name:
            return {}
            
        results = {}
        for cmd in _COMMANDS:
            try:
                full_cmd = ["docker", "exec", node_name, "sh", "-c", cmd]
                res = subprocess.run(full_cmd, capture_output=True, text=True, timeout=10, check=True)
                results[cmd] = res.stdout
            except Exception as e:
                logger.warning("Generic collect failed for %s (%s): %s", node_name, cmd, e)
                results[cmd] = "[]"
        return results
