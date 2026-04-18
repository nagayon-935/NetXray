"""
Packet capture manager — spawns a netshoot container with tcpdump,
streams pcap data to a WebSocket client as base64-encoded chunks.

Architecture
------------
Each capture session gets its own short-lived container:
  docker run --rm --net container:<target> nicolaka/netshoot
         tcpdump -i <iface> -U -w - [filter]

The raw pcap bytes are piped out of the container and forwarded to the
frontend over a WebSocket.  The frontend receives them as base64 text
frames and hands them to a JS pcap parser / download link.

No VNC / Wireshark GUI is required — this keeps dependencies minimal
and works in headless environments.  The frontend can use @jkcoxson/pcap
or SharkdJS to decode packets, or just offer a .pcap download button.

Limits
------
* MAX_CAPTURES concurrent sessions (returns 429 when exceeded).
* Each capture auto-stops after MAX_DURATION_SEC if not stopped manually.
* Requires /var/run/docker.sock mounted when NetXray runs inside Docker.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

MAX_CAPTURES = 5
MAX_DURATION_SEC = 600  # 10 min hard limit

PRESET_FILTERS: dict[str, str] = {
    "bgp":  "tcp port 179",
    "ospf": "proto ospf",
    "isis": "clnp or esis or isis",
    "evpn": "udp port 4789 or tcp port 179",
    "all":  "",
}

NETSHOOT_IMAGE = "nicolaka/netshoot"


@dataclass
class CaptureSession:
    id: str
    node: str
    interface: str
    filter: str
    container_name: str
    started_at: str
    proc: asyncio.subprocess.Process | None = None
    task: asyncio.Task | None = None
    _send_fn: object = field(default=None, repr=False)

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "node": self.node,
            "interface": self.interface,
            "filter": self.filter,
            "started_at": self.started_at,
            "running": self.proc is not None and self.proc.returncode is None,
        }


_sessions: dict[str, CaptureSession] = {}


def _container_name_for_node(node: str) -> str:
    """Guess the full containerlab container name from a short node name."""
    # containerlab naming: clab-<topo>-<node>
    # We try the node name as-is first; the caller can also pass the full name.
    return node


async def start_capture(
    node: str,
    interface: str,
    tcpdump_filter: str,
    send_chunk: object,  # async callable(bytes) → None
) -> str:
    """
    Start a tcpdump capture session on *node*/*interface*.
    Returns the session ID.  Raw pcap bytes are passed to *send_chunk*.
    """
    if len(_sessions) >= MAX_CAPTURES:
        raise RuntimeError(f"Max concurrent captures reached ({MAX_CAPTURES})")

    import datetime
    session_id = uuid.uuid4().hex[:8]
    container_name = _container_name_for_node(node)
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()

    session = CaptureSession(
        id=session_id,
        node=node,
        interface=interface,
        filter=tcpdump_filter,
        container_name=container_name,
        started_at=now,
        _send_fn=send_chunk,
    )
    _sessions[session_id] = session

    session.task = asyncio.create_task(
        _run_capture(session),
        name=f"capture:{session_id}",
    )
    logger.info("Capture started: id=%s node=%s iface=%s", session_id, node, interface)
    return session_id


async def _run_capture(session: CaptureSession) -> None:
    filter_arg = session.filter or ""
    cmd = [
        "docker", "run", "--rm",
        "--net", f"container:{session.container_name}",
        "--cap-add", "NET_ADMIN",
        "--name", f"netxray-cap-{session.id}",
        NETSHOOT_IMAGE,
        "tcpdump", "-i", session.interface,
        "-U",   # packet-buffered (no delay)
        "-w", "-",  # write raw pcap to stdout
    ]
    if filter_arg:
        cmd += filter_arg.split()

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
        )
        session.proc = proc
        assert proc.stdout is not None

        import base64
        import asyncio as _aio

        async def _stream():
            while True:
                chunk = await proc.stdout.read(4096)
                if not chunk:
                    break
                encoded = base64.b64encode(chunk).decode()
                if callable(session._send_fn):
                    try:
                        await session._send_fn(encoded)
                    except Exception:
                        break

        await _aio.wait_for(_stream(), timeout=MAX_DURATION_SEC)

    except asyncio.TimeoutError:
        logger.info("Capture %s hit max duration (%ds)", session.id, MAX_DURATION_SEC)
    except FileNotFoundError:
        logger.error("docker binary not found — packet capture unavailable")
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.error("Capture error %s: %s", session.id, exc)
    finally:
        await _stop_proc(session)
        _sessions.pop(session.id, None)
        logger.info("Capture stopped: id=%s", session.id)


async def _stop_proc(session: CaptureSession) -> None:
    if session.proc and session.proc.returncode is None:
        try:
            session.proc.terminate()
            await asyncio.wait_for(session.proc.wait(), timeout=5)
        except Exception:
            pass
    # Also kill the named container in case it's stuck
    try:
        proc = await asyncio.create_subprocess_exec(
            "docker", "rm", "-f", f"netxray-cap-{session.id}",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await proc.wait()
    except Exception:
        pass


async def stop_capture(session_id: str) -> None:
    session = _sessions.get(session_id)
    if not session:
        return
    if session.task and not session.task.done():
        session.task.cancel()
    await _stop_proc(session)
    _sessions.pop(session_id, None)


def list_captures() -> list[dict]:
    return [s.as_dict() for s in _sessions.values()]


async def stop_all() -> None:
    """Called on backend shutdown to clean up all running captures."""
    for sid in list(_sessions.keys()):
        await stop_capture(sid)
