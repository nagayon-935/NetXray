"""
TelemetryManager — WebSocket channel manager for lab lifecycle log streaming.

Tracks per-run_id WebSocket subscriber sets and broadcasts lab log lines from
the lifecycle subprocess (clab_lifecycle.py) to connected clients.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class TelemetryManager:
    def __init__(self) -> None:
        # run_id → set of WebSocket connections for lab log streaming
        self._lab_connections: dict[str, set[WebSocket]] = {}

    async def connect_lab_log(self, run_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._lab_connections.setdefault(run_id, set()).add(websocket)

    def disconnect_lab_log(self, run_id: str, websocket: WebSocket) -> None:
        bucket = self._lab_connections.get(run_id, set())
        bucket.discard(websocket)
        if not bucket:
            self._lab_connections.pop(run_id, None)

    async def broadcast_lab_log(self, run_id: str, payload: dict[str, Any]) -> None:
        bucket = self._lab_connections.get(run_id)
        if not bucket:
            return
        message = json.dumps(payload)
        stale: set[WebSocket] = set()
        for ws in list(bucket):
            try:
                await ws.send_text(message)
            except Exception:
                stale.add(ws)
        for ws in stale:
            self.disconnect_lab_log(run_id, ws)


# Module-level singleton shared by ws.py, lab.py, iac.py
telemetry_manager = TelemetryManager()
