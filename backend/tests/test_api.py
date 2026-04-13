import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.main import app

client = TestClient(app)

SAMPLE_IR = json.loads(
    (Path(__file__).parent.parent.parent / "frontend" / "public" / "sample-topologies" / "simple-3node.json").read_text()
)


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


def test_save_and_get_topology(tmp_path, monkeypatch):
    monkeypatch.setattr("api.config.settings.data_dir", tmp_path)
    import api.routes.topology as topo_module
    monkeypatch.setattr(topo_module, "settings", type("S", (), {"data_dir": tmp_path, "schema_path": Path("/nonexistent")})())

    resp = client.post("/api/topology/test-lab", json=SAMPLE_IR)
    assert resp.status_code == 200
    assert resp.json()["name"] == "test-lab"

    resp = client.get("/api/topology/test-lab")
    assert resp.status_code == 200
    data = resp.json()
    assert data["ir_version"] == "0.2.0"


def test_get_nonexistent_topology(tmp_path, monkeypatch):
    import api.routes.topology as topo_module
    monkeypatch.setattr(topo_module, "settings", type("S", (), {"data_dir": tmp_path, "schema_path": Path("/nonexistent")})())

    resp = client.get("/api/topology/no-such-topology")
    assert resp.status_code == 404


def test_list_topologies(tmp_path, monkeypatch):
    import api.routes.topology as topo_module
    fake_settings = type("S", (), {"data_dir": tmp_path, "schema_path": Path("/nonexistent")})()
    monkeypatch.setattr(topo_module, "settings", fake_settings)

    # Save two topologies
    client.post("/api/topology/lab-a", json=SAMPLE_IR)
    client.post("/api/topology/lab-b", json=SAMPLE_IR)

    resp = client.get("/api/topologies")
    assert resp.status_code == 200
    names = [t["name"] for t in resp.json()["topologies"]]
    assert "lab-a" in names
    assert "lab-b" in names


def test_delete_topology(tmp_path, monkeypatch):
    import api.routes.topology as topo_module
    monkeypatch.setattr(topo_module, "settings", type("S", (), {"data_dir": tmp_path, "schema_path": Path("/nonexistent")})())

    client.post("/api/topology/to-delete", json=SAMPLE_IR)
    resp = client.delete("/api/topology/to-delete")
    assert resp.status_code == 200

    resp = client.get("/api/topology/to-delete")
    assert resp.status_code == 404
