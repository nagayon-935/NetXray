"""Tests for collector/telemetry_manager.py."""
from unittest.mock import AsyncMock, MagicMock

import pytest

from collector.telemetry_manager import TelemetryManager


@pytest.fixture
def tm():
    return TelemetryManager()


@pytest.mark.asyncio
async def test_connect_lab_log_accepts_and_stores(tm):
    ws = AsyncMock()
    await tm.connect_lab_log("run-1", ws)
    assert ws in tm._lab_connections["run-1"]
    ws.accept.assert_awaited_once()


@pytest.mark.asyncio
async def test_disconnect_lab_log_removes_empty_bucket(tm):
    ws = AsyncMock()
    await tm.connect_lab_log("run-1", ws)
    tm.disconnect_lab_log("run-1", ws)
    assert "run-1" not in tm._lab_connections


def test_disconnect_lab_log_keeps_other_websockets():
    tm = TelemetryManager()
    ws1 = MagicMock()
    ws2 = MagicMock()
    tm._lab_connections["run-1"] = {ws1, ws2}
    tm.disconnect_lab_log("run-1", ws1)
    assert ws2 in tm._lab_connections["run-1"]


@pytest.mark.asyncio
async def test_broadcast_lab_log_sends_to_all(tm):
    ws1 = AsyncMock()
    ws2 = AsyncMock()
    await tm.connect_lab_log("run-1", ws1)
    await tm.connect_lab_log("run-1", ws2)

    await tm.broadcast_lab_log("run-1", {"type": "log", "line": "hello"})

    ws1.send_text.assert_awaited_once()
    ws2.send_text.assert_awaited_once()


@pytest.mark.asyncio
async def test_broadcast_lab_log_no_connections_does_nothing(tm):
    await tm.broadcast_lab_log("run-1", {"type": "log"})


@pytest.mark.asyncio
async def test_broadcast_lab_log_removes_stale_websocket(tm):
    ws1 = AsyncMock()
    ws2 = AsyncMock()
    ws2.send_text.side_effect = RuntimeError("closed")

    await tm.connect_lab_log("run-1", ws1)
    await tm.connect_lab_log("run-1", ws2)

    await tm.broadcast_lab_log("run-1", {"type": "log", "line": "hello"})

    assert ws2 not in tm._lab_connections.get("run-1", set())
    assert ws1 in tm._lab_connections["run-1"]


@pytest.mark.asyncio
async def test_broadcast_lab_log_json_payload(tm):
    import json

    ws = AsyncMock()
    await tm.connect_lab_log("run-1", ws)

    payload = {"type": "node_state", "node_id": "r1", "state": "running"}
    await tm.broadcast_lab_log("run-1", payload)

    sent = ws.send_text.call_args[0][0]
    assert json.loads(sent) == payload
