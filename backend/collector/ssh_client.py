"""Thin Netmiko wrapper with retry logic."""

import logging
import time

from netmiko import ConnectHandler, NetMikoAuthenticationException, NetMikoTimeoutException

logger = logging.getLogger(__name__)

_MAX_RETRIES = 3
_RETRY_DELAY = 2.0


def execute_commands(
    host: str,
    port: int,
    username: str,
    password: str,
    device_type: str,
    commands: list[str],
) -> dict[str, str]:
    """
    Connect via SSH and run commands.
    Returns {command -> output}.
    Raises RuntimeError on connection failure after retries.
    """
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            conn_params = dict(
                host=host,
                port=port,
                username=username,
                password=password,
                device_type=device_type,
                timeout=30,
                auth_timeout=30,
            )
            with ConnectHandler(**conn_params) as conn:
                results: dict[str, str] = {}
                for cmd in commands:
                    output = conn.send_command(cmd, read_timeout=60)
                    results[cmd] = output
                return results
        except (NetMikoAuthenticationException, NetMikoTimeoutException) as exc:
            logger.warning("SSH attempt %d/%d to %s failed: %s", attempt, _MAX_RETRIES, host, exc)
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_DELAY * attempt)
        except Exception as exc:
            logger.warning("SSH attempt %d/%d to %s failed: %s", attempt, _MAX_RETRIES, host, exc)
            if attempt < _MAX_RETRIES:
                time.sleep(_RETRY_DELAY * attempt)

    raise RuntimeError(f"SSH connection to {host} failed after {_MAX_RETRIES} attempts")
