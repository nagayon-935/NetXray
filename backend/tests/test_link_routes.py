"""Tests for api/routes/link.py impairment endpoints."""
import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture
def client(monkeypatch):
    import collector.clab_netem as netem
    import api.routes.link as link_module
    # Ensure clean state
    netem._ACTIVE.clear()
    yield TestClient(app)
    netem._ACTIVE.clear()


def test_set_impairment_one_direction(client, monkeypatch):
    import api.routes.link as link_module

    calls = []

    def fake_set(spec):
        calls.append(spec)

    monkeypatch.setattr(link_module, "set_impairment", fake_set)
    monkeypatch.setattr(link_module, "list_impairments", lambda: [])

    resp = client.post(
        "/api/link/impairment",
        json={
            "source_node": "r1",
            "source_interface": "eth1",
            "target_node": "r2",
            "target_interface": "eth1",
            "delay_ms": 10,
            "both_directions": False,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert len(calls) == 1
    assert calls[0].node == "r1"
    assert calls[0].interface == "eth1"
    assert calls[0].delay_ms == 10


def test_set_impairment_both_directions(client, monkeypatch):
    import api.routes.link as link_module

    calls = []

    def fake_set(spec):
        calls.append((spec.node, spec.interface, spec.delay_ms))

    monkeypatch.setattr(link_module, "set_impairment", fake_set)

    resp = client.post(
        "/api/link/impairment",
        json={
            "source_node": "r1",
            "source_interface": "eth1",
            "target_node": "r2",
            "target_interface": "eth2",
            "delay_ms": 20,
            "both_directions": True,
        },
    )
    assert resp.status_code == 200
    assert calls == [("r1", "eth1", 20), ("r2", "eth2", 20)]


def test_set_impairment_returns_errors(client, monkeypatch):
    import api.routes.link as link_module

    def fake_set(spec):
        raise RuntimeError("netem failed")

    monkeypatch.setattr(link_module, "set_impairment", fake_set)

    resp = client.post(
        "/api/link/impairment",
        json={
            "source_node": "r1",
            "source_interface": "eth1",
            "target_node": "r2",
            "target_interface": "eth2",
            "delay_ms": 5,
            "both_directions": False,
        },
    )
    assert resp.status_code == 500
    assert "netem failed" in resp.json()["detail"]


def test_clear_impairment_one_direction(client, monkeypatch):
    import api.routes.link as link_module

    calls = []

    def fake_clear(node, iface):
        calls.append((node, iface))

    monkeypatch.setattr(link_module, "clear_impairment", fake_clear)

    resp = client.request(
        "DELETE",
        "/api/link/impairment",
        json={
            "source_node": "r1",
            "source_interface": "eth1",
            "target_node": "r2",
            "target_interface": "eth2",
            "both_directions": False,
        },
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True
    assert calls == [("r1", "eth1")]


def test_clear_impairment_both_directions(client, monkeypatch):
    import api.routes.link as link_module

    calls = []

    def fake_clear(node, iface):
        calls.append((node, iface))

    monkeypatch.setattr(link_module, "clear_impairment", fake_clear)

    resp = client.request(
        "DELETE",
        "/api/link/impairment",
        json={
            "source_node": "r1",
            "source_interface": "eth1",
            "target_node": "r2",
            "target_interface": "eth2",
            "both_directions": True,
        },
    )
    assert resp.status_code == 200
    assert calls == [("r1", "eth1"), ("r2", "eth2")]


def test_clear_impairment_returns_errors(client, monkeypatch):
    import api.routes.link as link_module

    def fake_clear(node, iface):
        raise RuntimeError("reset failed")

    monkeypatch.setattr(link_module, "clear_impairment", fake_clear)

    resp = client.request(
        "DELETE",
        "/api/link/impairment",
        json={
            "source_node": "r1",
            "source_interface": "eth1",
            "target_node": "r2",
            "target_interface": "eth2",
            "both_directions": False,
        },
    )
    assert resp.status_code == 500
    assert "reset failed" in resp.json()["detail"]


def test_get_impairments(client, monkeypatch):
    import api.routes.link as link_module
    monkeypatch.setattr(
        link_module,
        "list_impairments",
        lambda: [{"node": "r1", "interface": "eth1", "delay_ms": 10}],
    )

    resp = client.get("/api/link/impairments")
    assert resp.status_code == 200
    assert resp.json()["impairments"] == [{"node": "r1", "interface": "eth1", "delay_ms": 10}]


def test_impairment_request_validation(client):
    # loss_pct out of range
    resp = client.post(
        "/api/link/impairment",
        json={
            "source_node": "r1",
            "source_interface": "eth1",
            "target_node": "r2",
            "target_interface": "eth2",
            "loss_pct": 150,
        },
    )
    assert resp.status_code == 422

    # negative delay
    resp = client.post(
        "/api/link/impairment",
        json={
            "source_node": "r1",
            "source_interface": "eth1",
            "target_node": "r2",
            "target_interface": "eth2",
            "delay_ms": -1,
        },
    )
    assert resp.status_code == 422
