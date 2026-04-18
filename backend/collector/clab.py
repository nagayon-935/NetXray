"""containerlab inspect integration and docker event streaming."""

import asyncio
import json
import logging
import subprocess
from dataclasses import dataclass
from typing import AsyncGenerator

logger = logging.getLogger(__name__)


@dataclass
class ClabNode:
    name: str
    mgmt_ip: str
    vendor: str    # "frr" | "arista" | "generic"
    state: str     # "running" | "stopped" | ...
    short_name: str | None = None


def _detect_vendor(image: str, kind: str) -> str:
    image_lower = image.lower()
    kind_lower = kind.lower()

    # Kind-based matching (more reliable)
    if any(k in kind_lower for k in ("arista_ceos", "ceos")):
        return "arista"
    if "frr" in kind_lower:
        return "frr"
    if "cisco_xrd" in kind_lower:
        return "cisco_xr"
    if "juniper_vjunos" in kind_lower:
        return "juniper_junos"

    # Image-based matching
    if any(k in image_lower for k in ("ceos", "arista", "eos")):
        return "arista"
    if "frr" in image_lower:
        return "frr"
    if "xrd" in image_lower:
        return "cisco_xr"
    if "vjunos" in image_lower:
        return "juniper_junos"

    # Generic kind-based fallback
    if "linux" in kind_lower:
        return "generic"

    return "generic"


def inspect_lab(topology_file: str | None = None) -> list[ClabNode]:
    """
    Run `containerlab inspect --format json` and return node list.
    topology_file: optional path to .clab.yml file
    """
    cmd = ["containerlab", "inspect", "--format", "json"]
    if topology_file:
        cmd += ["--topo", topology_file]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30, check=True)
        data = json.loads(result.stdout)
    except FileNotFoundError:
        raise RuntimeError("containerlab binary not found in PATH")
    except subprocess.TimeoutExpired:
        raise RuntimeError("containerlab inspect timed out")
    except subprocess.CalledProcessError as exc:
        raise RuntimeError(f"containerlab inspect failed: {exc.stderr}")
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"Failed to parse containerlab inspect output: {exc}")

    nodes: list[ClabNode] = []

    # containerlab inspect JSON format varies slightly by version
    # Try top-level list first, then "containers" key
    containers = data if isinstance(data, list) else data.get("containers", [])

    for container in containers:
        name = container.get("name") or container.get("longname", "")
        image = container.get("image", "")
        kind = container.get("kind", "")
        state = container.get("state", "running")

        # Management IP — try multiple fields
        mgmt_ip = (
            container.get("ipv4_address")
            or container.get("mgmt_ipv4_address")
            or container.get("ip_address", "")
        )
        # Strip prefix length (e.g. "172.20.0.2/24" -> "172.20.0.2")
        mgmt_ip = mgmt_ip.split("/")[0] if mgmt_ip else ""

        if not mgmt_ip:
            logger.warning("No management IP for node '%s', skipping", name)
            continue

        # Try to get the short name from labels
        labels = container.get("labels", {})
        short_name = labels.get("clab-node-name")

        vendor = _detect_vendor(image, kind)
        nodes.append(ClabNode(name=name, mgmt_ip=mgmt_ip, vendor=vendor, state=state, short_name=short_name))

    return nodes


async def stream_docker_events(lab_name: str) -> AsyncGenerator[tuple[str, str], None]:
    """
    Async generator yielding (node_id, state) from docker container events.
    Filtered by the clab-topo label so only containers for *lab_name* are watched.
    Yields states: "running" | "stopped".
    """
    cmd = [
        "docker", "events",
        "--filter", f"label=clab-topo={lab_name}",
        "--filter", "type=container",
        "--format", "{{json .}}",
    ]
    proc: asyncio.subprocess.Process | None = None
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        assert proc.stdout is not None
        async for raw in proc.stdout:
            try:
                event = json.loads(raw.decode())
                action = event.get("Action", "")
                attrs = (event.get("Actor") or {}).get("Attributes") or {}
                node_id = attrs.get("clab-node-name", "")
                if not node_id:
                    continue
                if action == "start":
                    yield node_id, "running"
                elif action in ("stop", "die", "kill"):
                    yield node_id, "stopped"
            except (json.JSONDecodeError, KeyError):
                continue
    except FileNotFoundError:
        logger.warning("docker binary not found — event streaming disabled")
    except asyncio.CancelledError:
        if proc and proc.returncode is None:
            proc.terminate()
            await proc.wait()
        raise


def exec_node(node_name: str, commands: list[str]) -> dict[str, str]:
    """Run a list of commands inside a node using `containerlab exec`."""
    results = {}
    for cmd_str in commands:
        # containerlab exec --label clab-node-name=node1 --cmd "vtysh -c '...'"
        full_cmd = [
            "containerlab",
            "exec",
            "--label",
            f"clab-node-name={node_name}",
            "--cmd",
            cmd_str,
        ]
        try:
            result = subprocess.run(
                full_cmd, capture_output=True, text=True, timeout=30, check=True
            )
            # containerlab exec output is stdout/stderr combined
            results[cmd_str] = result.stdout
        except Exception as exc:
            logger.error("Failed to exec '%s' in node %s: %s", cmd_str, node_name, exc)
            results[cmd_str] = f"ERROR: {exc}"
    return results
