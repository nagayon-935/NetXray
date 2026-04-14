"""Tests for telemetry manager and REST endpoints (Phase 9)."""
import asyncio
import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app
from collector.telemetry_manager import TelemetryManager


# ─── TelemetryManager unit tests ─────────────────────────────────────────────

class TestTelemetryManagerStatus:
    def test_initial_status_is_empty(self):
        mgr = TelemetryManager()
        status = mgr.status
        assert status["connections"] == {}
        assert status["active_loops"] == []

    def test_start_and_stop_loop(self):
        mgr = TelemetryManager()

        # start_for_topology requires a running event loop
        async def run():
            started = mgr.start_for_topology("test-topo")
            assert started is True
            assert "test-topo" in mgr.status["active_loops"]

            # Starting again returns False (already running)
            again = mgr.start_for_topology("test-topo")
            assert again is False

            # Stop
            stopped = mgr.stop_for_topology("test-topo")
            assert stopped is True

            # Allow the cancellation to propagate
            await asyncio.sleep(0)

            assert "test-topo" not in mgr.status["active_loops"]

        asyncio.run(run())

    def test_stop_nonexistent_returns_false(self):
        mgr = TelemetryManager()
        assert mgr.stop_for_topology("nonexistent") is False


class TestMockCounters:
    def test_patches_use_tilde_node_id_path(self, monkeypatch):
        """Mock counter patches must use /topology/nodes/~{id}/... path format."""
        mgr = TelemetryManager()

        fake_ir = {
            "topology": {
                "nodes": [
                    {
                        "id": "r1",
                        "interfaces": {
                            "eth0": {"ip": "10.0.0.1/30", "state": "up"},
                        },
                    }
                ],
                "links": [],
            }
        }
        monkeypatch.setattr("api.state._current_ir", fake_ir)

        captured: list = []

        async def fake_broadcast(topology_name, patch):
            captured.extend(patch)

        monkeypatch.setattr(mgr, "broadcast_patch", fake_broadcast)

        asyncio.run(mgr._send_mock_counters("test"))

        assert len(captured) == 3  # in_bps, out_bps, last_updated
        paths = [op["path"] for op in captured]
        assert all("/topology/nodes/~r1/interfaces/eth0/" in p for p in paths)
        assert all(op["op"] == "replace" for op in captured)

    def test_skips_interfaces_without_ip(self, monkeypatch):
        """Interfaces with no IP (e.g. loopbacks without address) are skipped."""
        mgr = TelemetryManager()

        fake_ir = {
            "topology": {
                "nodes": [
                    {
                        "id": "r1",
                        "interfaces": {
                            "lo": {"state": "up"},           # no ip → skip
                            "eth0": {"ip": "10.0.0.1/30", "state": "up"},
                        },
                    }
                ],
                "links": [],
            }
        }
        monkeypatch.setattr("api.state._current_ir", fake_ir)

        captured: list = []

        async def fake_broadcast(topology_name, patch):
            captured.extend(patch)

        monkeypatch.setattr(mgr, "broadcast_patch", fake_broadcast)
        asyncio.run(mgr._send_mock_counters("test"))

        paths = [op["path"] for op in captured]
        assert all("/interfaces/eth0/" in p for p in paths)
        assert not any("/interfaces/lo/" in p for p in paths)

    def test_no_patches_when_ir_is_none(self, monkeypatch):
        """No broadcast should happen when the IR is not loaded."""
        mgr = TelemetryManager()
        monkeypatch.setattr("api.state._current_ir", None)

        broadcast_called = []

        async def fake_broadcast(topology_name, patch):
            broadcast_called.append(patch)

        monkeypatch.setattr(mgr, "broadcast_patch", fake_broadcast)
        asyncio.run(mgr._send_mock_counters("test"))

        assert broadcast_called == []


# ─── REST endpoints ───────────────────────────────────────────────────────────

@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


class TestTelemetryEndpoints:
    async def test_status_endpoint(self, client):
        resp = await client.get("/api/telemetry/status")
        assert resp.status_code == 200
        data = resp.json()
        assert "connections" in data
        assert "active_loops" in data

    async def test_subscribe_starts_loop(self, client):
        resp = await client.post(
            "/api/telemetry/subscribe",
            json={"topology_name": "test-sub", "nodes": ["r1"]},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["topology"] == "test-sub"
        assert data["status"] in ("started", "already_running")

        # Cleanup: stop the loop so it doesn't pollute other tests
        from collector.telemetry_manager import telemetry_manager
        telemetry_manager.stop_for_topology("test-sub")
        await asyncio.sleep(0)

    async def test_unsubscribe_nonexistent_returns_404(self, client):
        resp = await client.delete("/api/telemetry/subscribe/no-such-topo")
        assert resp.status_code == 404
