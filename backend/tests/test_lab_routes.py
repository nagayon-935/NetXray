"""Tests for api/routes/lab.py lifecycle endpoints."""
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    """Provide a TestClient with lab module globals patched for isolation."""
    import api.routes.lab as lab_module
    import collector.clab_lifecycle as lifecycle

    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", tmp_path)

    # Patch lab module-level imports (copies of lifecycle functions)
    monkeypatch.setattr(lab_module, "is_running", lambda: False)
    monkeypatch.setattr(lab_module, "active_run_id", lambda: None)
    monkeypatch.setattr(lab_module, "start_node_watch", lambda *a, **k: None)
    monkeypatch.setattr(lab_module, "stop_node_watch", lambda *a, **k: None)

    yield TestClient(app)

    # Cleanup lifecycle global state
    for lab_name in list(lifecycle._WATCH_TASKS.keys()):
        lifecycle.stop_node_watch(lab_name)
    lifecycle._RUN_LOGS.clear()
    lifecycle._active_task = None
    lifecycle._active_run_id = None


def _fake_lifecycle(run_id: str = "abc123"):
    async def start(action, topology_file, extra, broadcast):
        return run_id
    return start


def test_lab_topologies_lists_clab_files(client, tmp_path, monkeypatch):
    import api.routes.lab as lab_module
    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", tmp_path)

    (tmp_path / "spine-leaf.clab.yml").write_text("name: spine-leaf\n")
    (tmp_path / "core.clab.yaml").write_text("name: core\n")
    (tmp_path / "ignore.txt").write_text("ignored\n")

    resp = client.get("/api/lab/topologies")
    assert resp.status_code == 200
    names = [t["name"] for t in resp.json()["topologies"]]
    assert "spine-leaf" in names
    assert "core" in names
    assert "ignore" not in names


def test_lab_topologies_empty_when_dir_missing(client, monkeypatch, tmp_path):
    import api.routes.lab as lab_module
    nonexistent = tmp_path / "does-not-exist"
    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", nonexistent)

    resp = client.get("/api/lab/topologies")
    assert resp.status_code == 200
    assert resp.json()["topologies"] == []


def test_lab_name_from_topo_uses_yaml_name(client, tmp_path, monkeypatch):
    import api.routes.lab as lab_module

    topo_file = tmp_path / "my-lab.clab.yml"
    topo_file.write_text("name: yaml-name\n")
    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", tmp_path)
    monkeypatch.setattr(lab_module, "is_running", lambda: False)
    monkeypatch.setattr(lab_module, "start_lifecycle", _fake_lifecycle("run-1"))

    resp = client.post("/api/lab/deploy", json={"topology_file": "my-lab"})
    assert resp.status_code == 200
    assert resp.json()["run_id"] == "run-1"


def test_lab_name_from_topo_falls_back_to_stem(client, tmp_path, monkeypatch):
    import api.routes.lab as lab_module

    topo_file = tmp_path / "fallback.clab.yml"
    topo_file.write_text("topology:\n  nodes:\n")  # no name key
    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", tmp_path)
    monkeypatch.setattr(lab_module, "is_running", lambda: False)
    monkeypatch.setattr(lab_module, "start_lifecycle", _fake_lifecycle("run-2"))

    resp = client.post("/api/lab/redeploy", json={"topology_file": "fallback"})
    assert resp.status_code == 200
    assert resp.json()["run_id"] == "run-2"


def test_resolve_topo_returns_absolute_path(client, tmp_path, monkeypatch):
    import api.routes.lab as lab_module
    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", tmp_path)

    topo_file = tmp_path / "resolve.clab.yml"
    topo_file.write_text("name: resolve\n")

    assert lab_module._resolve_topo("resolve") == str(topo_file)
    assert lab_module._resolve_topo("resolve.clab.yml") == str(topo_file)
    assert lab_module._resolve_topo(str(topo_file)) == str(topo_file)


def test_resolve_topo_returns_input_when_missing(client, tmp_path, monkeypatch):
    import api.routes.lab as lab_module
    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", tmp_path)
    assert lab_module._resolve_topo("no-such") == "no-such"


def test_deploy_reconfigure_flag(client, tmp_path, monkeypatch):
    import api.routes.lab as lab_module

    topo_file = tmp_path / "reconf.clab.yml"
    topo_file.write_text("name: reconf\n")
    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", tmp_path)
    monkeypatch.setattr(lab_module, "is_running", lambda: False)

    calls = []

    async def fake_start(action, topo, extra, broadcast):
        calls.append((action, topo, extra))
        return "run-reconf"

    monkeypatch.setattr(lab_module, "start_lifecycle", fake_start)

    resp = client.post("/api/lab/deploy", json={"topology_file": "reconf", "reconfigure": True})
    assert resp.status_code == 200
    assert calls[0][2] == ["--reconfigure"]


def test_destroy_cleanup_flag(client, tmp_path, monkeypatch):
    import api.routes.lab as lab_module

    topo_file = tmp_path / "destroy.clab.yml"
    topo_file.write_text("name: destroy\n")
    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", tmp_path)
    monkeypatch.setattr(lab_module, "is_running", lambda: False)

    calls = []

    async def fake_start(action, topo, extra, broadcast):
        calls.append((action, topo, extra))
        return "run-destroy"

    monkeypatch.setattr(lab_module, "start_lifecycle", fake_start)

    resp = client.post("/api/lab/destroy", json={"topology_file": "destroy", "cleanup": True})
    assert resp.status_code == 200
    assert calls[0][2] == ["--cleanup"]


def test_redeploy_cleanup_flag(client, tmp_path, monkeypatch):
    import api.routes.lab as lab_module

    topo_file = tmp_path / "redeploy.clab.yml"
    topo_file.write_text("name: redeploy\n")
    monkeypatch.setattr(lab_module.settings, "clab_labs_dir", tmp_path)
    monkeypatch.setattr(lab_module, "is_running", lambda: False)

    calls = []

    async def fake_start(action, topo, extra, broadcast):
        calls.append((action, topo, extra))
        return "run-redeploy"

    monkeypatch.setattr(lab_module, "start_lifecycle", fake_start)

    resp = client.post("/api/lab/redeploy", json={"topology_file": "redeploy", "cleanup": True})
    assert resp.status_code == 200
    assert calls[0] == ("deploy", str(topo_file), ["--reconfigure", "--cleanup"])


def test_busy_returns_409(client, monkeypatch):
    import api.routes.lab as lab_module

    monkeypatch.setattr(lab_module, "is_running", lambda: True)
    monkeypatch.setattr(lab_module, "active_run_id", lambda: "busy-run")

    resp = client.post("/api/lab/deploy", json={"topology_file": "x"})
    assert resp.status_code == 409
    assert "busy-run" in resp.json()["detail"]


def test_start_lifecycle_runtime_error_returns_409(client, monkeypatch):
    import api.routes.lab as lab_module

    monkeypatch.setattr(lab_module, "is_running", lambda: False)

    async def raise_runtime(*a, **k):
        raise RuntimeError("already running")

    monkeypatch.setattr(lab_module, "start_lifecycle", raise_runtime)

    resp = client.post("/api/lab/deploy", json={"topology_file": "x"})
    assert resp.status_code == 409
    assert "already running" in resp.json()["detail"]


def test_status_endpoint(client, monkeypatch):
    import api.routes.lab as lab_module
    monkeypatch.setattr(lab_module, "is_running", lambda: True)
    monkeypatch.setattr(lab_module, "active_run_id", lambda: "run-status")

    resp = client.get("/api/lab/status")
    assert resp.status_code == 200
    assert resp.json() == {"running": True, "run_id": "run-status"}


def test_logs_endpoint(client, monkeypatch):
    import api.routes.lab as lab_module
    monkeypatch.setattr(lab_module, "get_run_logs", lambda rid: ["line1", "line2"])

    resp = client.get("/api/lab/logs/run-xyz")
    assert resp.status_code == 200
    assert resp.json()["logs"] == ["line1", "line2"]


def test_lifecycle_request_validation_rejects_bad_path(client):
    resp = client.post("/api/lab/deploy", json={"topology_file": "../etc/passwd; rm -rf /"})
    assert resp.status_code == 422


def test_lab_name_from_topo_extension_stripping():
    import api.routes.lab as lab_module
    assert lab_module._lab_name_from_topo("/foo/bar.clab.yml") == "bar"
    assert lab_module._lab_name_from_topo("/foo/bar.clab.yaml") == "bar"
    assert lab_module._lab_name_from_topo("/foo/bar.yml") == "bar"
