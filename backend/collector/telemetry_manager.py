"""
TelemetryManager — tracks WebSocket connections and drives mock telemetry.

Architecture
------------
* One mock-telemetry ``asyncio.Task`` runs per *topology name* while at least
  one WebSocket client is connected.  The task is cancelled when the last
  client disconnects.
* JSON Patch payloads use the extended `~{nodeId}` path segment so the
  frontend can resolve patches without knowing array indices.
* In a production deployment this module would also manage real gNMI
  subscriptions (see gnmi_client.py) and translate gNMI Notifications
  into the same JSON Patch format.
"""

from __future__ import annotations

import asyncio
import datetime
import json
import logging
import random
from typing import Any

from fastapi import WebSocket

from constants import MOCK_TELEMETRY_INTERVAL_SEC, MOCK_TRAFFIC_MIN_BPS, MOCK_TRAFFIC_MAX_BPS

logger = logging.getLogger(__name__)


def _generate_mock_patches(ir: dict[str, Any]) -> list[dict[str, Any]]:
    """
    Pure function: build JSON Patch ops from the current IR.

    Generates ``replace`` ops for ``traffic_in_bps``, ``traffic_out_bps``,
    and ``last_updated`` on every interface that has an IP address.
    Uses the ``~{nodeId}`` extended path syntax for array element lookup.

    Returns an empty list when the IR has no qualifying interfaces.
    """
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    patches: list[dict[str, Any]] = []

    for node in (ir.get("topology") or {}).get("nodes") or []:
        node_id = node.get("id")
        if not node_id:
            continue
        interfaces = node.get("interfaces") or {}
        for iface_name, iface in interfaces.items():
            if not iface.get("ip"):
                continue

            in_bps = random.randint(MOCK_TRAFFIC_MIN_BPS, MOCK_TRAFFIC_MAX_BPS)
            out_bps = random.randint(MOCK_TRAFFIC_MIN_BPS, MOCK_TRAFFIC_MAX_BPS)

            base = f"/topology/nodes/~{node_id}/interfaces/{iface_name}"
            patches += [
                {"op": "replace", "path": f"{base}/traffic_in_bps",  "value": in_bps},
                {"op": "replace", "path": f"{base}/traffic_out_bps", "value": out_bps},
                {"op": "replace", "path": f"{base}/last_updated",    "value": now},
            ]

    return patches


class TelemetryManager:
    def __init__(self) -> None:
        # topology_name → set of live WebSocket connections
        self._connections: dict[str, set[WebSocket]] = {}
        # topology_name → running mock-telemetry Task
        self._tasks: dict[str, asyncio.Task[None]] = {}

    # ── WebSocket lifecycle ───────────────────────────────────────────────

    async def connect(self, topology_name: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(topology_name, set()).add(websocket)
        logger.info("WS connected: topology=%s total=%d",
                    topology_name, len(self._connections[topology_name]))

        # Start mock-telemetry loop if not already running
        if topology_name not in self._tasks or self._tasks[topology_name].done():
            task = asyncio.create_task(
                self._mock_loop(topology_name),
                name=f"telemetry:{topology_name}",
            )
            self._tasks[topology_name] = task

    def disconnect(self, topology_name: str, websocket: WebSocket) -> None:
        bucket = self._connections.get(topology_name, set())
        bucket.discard(websocket)
        if not bucket:
            self._connections.pop(topology_name, None)
            # Cancel the mock loop — no clients remain
            task = self._tasks.pop(topology_name, None)
            if task and not task.done():
                task.cancel()
            logger.info("WS disconnected: topology=%s (last client)", topology_name)
        else:
            logger.info("WS disconnected: topology=%s remaining=%d",
                        topology_name, len(bucket))

    # ── Broadcast ─────────────────────────────────────────────────────────

    async def broadcast_patch(
        self, topology_name: str, patch: list[dict[str, Any]]
    ) -> None:
        """Send a JSON Patch array to every client for *topology_name*."""
        bucket = self._connections.get(topology_name)
        if not bucket:
            return

        message = json.dumps(patch)
        stale: set[WebSocket] = set()

        for ws in list(bucket):
            try:
                await ws.send_text(message)
            except Exception as exc:
                logger.debug("Send failed (%s) — marking client as stale", exc)
                stale.add(ws)

        for ws in stale:
            self.disconnect(topology_name, ws)

    # ── Mock telemetry loop ───────────────────────────────────────────────

    async def _mock_loop(self, topology_name: str) -> None:
        """
        Continuously generate random interface-counter patches and broadcast
        them to all WebSocket clients for *topology_name*.

        Uses the `~{nodeId}` extended JSON Patch path syntax so the frontend
        can locate nodes by ID without knowing array indices.
        """
        logger.info("Mock telemetry loop started: topology=%s", topology_name)
        try:
            while True:
                await self._send_mock_counters(topology_name)
                await asyncio.sleep(MOCK_TELEMETRY_INTERVAL_SEC)
        except asyncio.CancelledError:
            logger.info("Mock telemetry loop cancelled: topology=%s", topology_name)

    async def _send_mock_counters(self, topology_name: str) -> None:
        """Build and broadcast one round of fake traffic counters."""
        from api.state import get_current_ir

        ir = get_current_ir()
        if not ir:
            return

        patches = _generate_mock_patches(ir)
        if patches:
            await self.broadcast_patch(topology_name, patches)

    # ── Manual trigger (used by /api/telemetry/subscribe) ────────────────

    def start_for_topology(self, topology_name: str) -> bool:
        """
        Ensure the mock loop is running for *topology_name*.
        Returns True if a new task was started, False if already running.
        """
        if topology_name in self._tasks and not self._tasks[topology_name].done():
            return False
        task = asyncio.create_task(
            self._mock_loop(topology_name),
            name=f"telemetry:{topology_name}",
        )
        self._tasks[topology_name] = task
        # Create a placeholder connections set so broadcast works even if
        # no WebSocket client is connected yet (edge case).
        self._connections.setdefault(topology_name, set())
        return True

    def stop_for_topology(self, topology_name: str) -> bool:
        """Cancel the mock loop for *topology_name*. Returns True if stopped."""
        task = self._tasks.pop(topology_name, None)
        if task and not task.done():
            task.cancel()
            return True
        return False

    @property
    def status(self) -> dict[str, Any]:
        return {
            "connections": {
                name: len(conns)
                for name, conns in self._connections.items()
            },
            "active_loops": [
                name
                for name, t in self._tasks.items()
                if not t.done()
            ],
        }


# Module-level singleton shared by ws.py and telemetry.py
telemetry_manager = TelemetryManager()
