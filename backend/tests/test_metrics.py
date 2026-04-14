"""Tests for the derive_metrics() function and the /metrics HTTP endpoint."""
import pytest
from httpx import AsyncClient, ASGITransport
from api.main import app
from metrics import derive_metrics


# ─── derive_metrics() unit tests ─────────────────────────────────────────────

class TestDeriveMetrics:
    def test_empty_ir_returns_zero_counts(self):
        m = derive_metrics({})
        assert m.nodes.count_by_type == {}
        assert m.interfaces.up_count == 0
        assert m.interfaces.down_count == 0
        assert m.links.down_count == 0
        assert m.interfaces.traffic == {}

    def test_node_type_counting(self):
        ir = {
            "topology": {
                "nodes": [
                    {"id": "r1", "type": "router"},
                    {"id": "r2", "type": "router"},
                    {"id": "sw1", "type": "switch"},
                ],
                "links": [],
            }
        }
        m = derive_metrics(ir)
        assert m.nodes.count_by_type["router"] == 2
        assert m.nodes.count_by_type["switch"] == 1

    def test_bgp_state_counting(self):
        ir = {
            "topology": {
                "nodes": [
                    {
                        "id": "r1",
                        "bgp": {
                            "sessions": [
                                {"state": "established"},
                                {"state": "established"},
                                {"state": "idle"},
                            ]
                        },
                    },
                    {
                        "id": "r2",
                        "bgp": {
                            "sessions": [
                                {"state": "established"},
                                {"state": "notastate"},  # maps to unknown
                            ]
                        },
                    },
                ],
                "links": [],
            }
        }
        m = derive_metrics(ir)
        assert m.bgp.sessions_by_state["established"] == 3
        assert m.bgp.sessions_by_state["idle"] == 1
        assert m.bgp.sessions_by_state["unknown"] == 1

    def test_interface_up_down_counting(self):
        ir = {
            "topology": {
                "nodes": [
                    {
                        "id": "r1",
                        "interfaces": {
                            "eth0": {"state": "up"},
                            "eth1": {"state": "down"},
                            "eth2": {"state": "up"},
                        },
                    }
                ],
                "links": [],
            }
        }
        m = derive_metrics(ir)
        assert m.interfaces.up_count == 2
        assert m.interfaces.down_count == 1

    def test_traffic_dict_populated_for_nonzero_bps(self):
        ir = {
            "topology": {
                "nodes": [
                    {
                        "id": "r1",
                        "interfaces": {
                            "eth0": {"state": "up", "traffic_in_bps": 1000, "traffic_out_bps": 500},
                            "eth1": {"state": "up", "traffic_in_bps": 0, "traffic_out_bps": 0},
                            "eth2": {"state": "up", "traffic_in_bps": 0, "traffic_out_bps": 200},
                        },
                    }
                ],
                "links": [],
            }
        }
        m = derive_metrics(ir)
        assert ("r1", "eth0") in m.interfaces.traffic
        assert m.interfaces.traffic[("r1", "eth0")] == (1000, 500)
        # eth1 has all zeros, should not appear
        assert ("r1", "eth1") not in m.interfaces.traffic
        # eth2 has nonzero out_bps, should appear
        assert ("r1", "eth2") in m.interfaces.traffic
        assert m.interfaces.traffic[("r1", "eth2")] == (0, 200)

    def test_link_down_count(self):
        ir = {
            "topology": {
                "nodes": [],
                "links": [
                    {"id": "l1", "state": "up"},
                    {"id": "l2", "state": "down"},
                    {"id": "l3", "state": "down"},
                ],
            }
        }
        m = derive_metrics(ir)
        assert m.links.down_count == 2


# ─── /metrics HTTP endpoint tests ────────────────────────────────────────────

@pytest.fixture
async def client():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


FAKE_IR = {
    "topology": {
        "nodes": [
            {
                "id": "r1",
                "type": "router",
                "vendor": "frr",
                "bgp": {
                    "sessions": [
                        {"state": "established"},
                        {"state": "idle"},
                    ]
                },
                "interfaces": {
                    "eth0": {"state": "up"},
                },
            }
        ],
        "links": [
            {"id": "l1", "state": "down"},
        ],
    }
}


class TestMetricsEndpoint:
    async def test_returns_200_with_text_plain(self, client):
        resp = await client.get("/metrics")
        assert resp.status_code == 200
        assert "text/plain" in resp.headers["content-type"]

    async def test_with_ir_contains_bgp_sessions(self, client, monkeypatch):
        monkeypatch.setattr("api.state._current_ir", FAKE_IR)
        resp = await client.get("/metrics")
        assert resp.status_code == 200
        assert "netxray_bgp_sessions_total" in resp.text

    async def test_with_ir_contains_links_down(self, client, monkeypatch):
        monkeypatch.setattr("api.state._current_ir", FAKE_IR)
        resp = await client.get("/metrics")
        assert resp.status_code == 200
        assert "netxray_links_down_total" in resp.text

    async def test_without_ir_returns_200_with_sample_bgp(self, client, monkeypatch):
        monkeypatch.setattr("api.state._current_ir", None)
        resp = await client.get("/metrics")
        assert resp.status_code == 200
        # Sample data sets established=4 — check the metric name is present
        assert "netxray_bgp_sessions_total" in resp.text
