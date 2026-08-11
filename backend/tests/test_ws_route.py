"""Tests for api/routes/ws.py WebSocket log streaming."""
import json
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import WebSocketDisconnect
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture
def client():
    return TestClient(app)


def test_ws_lab_log_replays_buffered_lines(client, monkeypatch):
    import api.routes.ws as ws_module
    import collector.clab_lifecycle as lifecycle

    monkeypatch.setattr(lifecycle, "get_run_logs", lambda rid: ["log1", "log2"])

    class FakeWebSocket:
        def __init__(self):
            self.sent = []

        async def accept(self):
            pass

        async def send_text(self, text):
            self.sent.append(text)

        async def receive_text(self):
            raise WebSocketDisconnect()

    mock_ws = FakeWebSocket()

    async def fake_connect(run_id, websocket):
        await websocket.accept()

    fake_tm = MagicMock()
    fake_tm.connect_lab_log = fake_connect
    fake_tm.disconnect_lab_log = MagicMock()
    monkeypatch.setattr(ws_module, "telemetry_manager", fake_tm)

    import asyncio
    asyncio.run(ws_module.lab_log_endpoint(mock_ws, "run-1"))

    assert len(mock_ws.sent) == 2
    assert json.loads(mock_ws.sent[0]) == {"type": "log", "line": "log1"}
    assert json.loads(mock_ws.sent[1]) == {"type": "log", "line": "log2"}


def test_ws_lab_log_disconnect_handled(client, monkeypatch):
    import api.routes.ws as ws_module
    import collector.clab_lifecycle as lifecycle

    monkeypatch.setattr(lifecycle, "get_run_logs", lambda rid: [])

    class FakeWebSocket:
        def __init__(self):
            self.accepted = False

        async def accept(self):
            self.accepted = True

        async def receive_text(self):
            raise WebSocketDisconnect()

    mock_ws = FakeWebSocket()

    async def fake_connect(run_id, websocket):
        await websocket.accept()

    fake_tm = MagicMock()
    fake_tm.connect_lab_log = fake_connect
    fake_tm.disconnect_lab_log = MagicMock()
    monkeypatch.setattr(ws_module, "telemetry_manager", fake_tm)

    import asyncio
    asyncio.run(ws_module.lab_log_endpoint(mock_ws, "run-2"))

    assert mock_ws.accepted is True
    fake_tm.disconnect_lab_log.assert_called_once_with("run-2", mock_ws)


def test_ws_lab_log_send_exception_breaks_loop(client, monkeypatch):
    import api.routes.ws as ws_module
    import collector.clab_lifecycle as lifecycle

    monkeypatch.setattr(lifecycle, "get_run_logs", lambda rid: ["log1"])

    class FakeWebSocket:
        async def accept(self):
            pass

        async def send_text(self, text):
            raise RuntimeError("send failed")

    mock_ws = FakeWebSocket()

    async def fake_connect(run_id, websocket):
        await websocket.accept()

    fake_tm = MagicMock()
    fake_tm.connect_lab_log = fake_connect
    fake_tm.disconnect_lab_log = MagicMock()
    monkeypatch.setattr(ws_module, "telemetry_manager", fake_tm)

    import asyncio
    asyncio.run(ws_module.lab_log_endpoint(mock_ws, "run-3"))

    fake_tm.disconnect_lab_log.assert_called_once_with("run-3", mock_ws)
