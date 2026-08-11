"""Tests for api/routes/collect.py."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from api.main import app


@pytest.fixture
def client(monkeypatch, tmp_path):
    import api.config
    import api.routes.topology as topo_module
    monkeypatch.setattr(api.config.settings, "data_dir", tmp_path)
    monkeypatch.setattr(topo_module, "settings", type("S", (), {"data_dir": tmp_path, "schema_path": Path("/nonexistent")})())
    yield TestClient(app)


def _make_clab_node(name, vendor="frr", mgmt_ip="10.0.0.1", short_name=None):
    from collector.clab import ClabNode
    return ClabNode(name=name, mgmt_ip=mgmt_ip, vendor=vendor, state="running", short_name=short_name or name)


def _minimal_ir():
    return {
        "ir_version": "0.2.0",
        "metadata": {"name": "test"},
        "topology": {"nodes": [], "links": []},
    }


def test_collect_happy_path(client, monkeypatch, tmp_path):
    import api.routes.collect as collect_module
    import collector.clab as clab
    import collector.drivers as drivers
    import translator.ir_builder as ir_builder
    import translator.parsers as parsers

    topo_file = tmp_path / "lab.clab.yml"
    topo_file.write_text(
        "name: lab\ntopology:\n  nodes:\n    r1:\n      kind: linux\n  links:\n"
        "    - endpoints: [\"r1:eth1\", \"r2:eth1\"]\n"
    )

    fake_nodes = [_make_clab_node("clab-lab-r1", "frr", "10.0.0.1", "r1")]
    fake_links = [clab.ClabLink("r1", "eth1", "r2", "eth1")]
    fake_positions = {"r1": {"x": 1.0, "y": 2.0}}

    monkeypatch.setattr(clab, "inspect_lab", lambda topo: fake_nodes)
    monkeypatch.setattr(clab, "get_links_from_topo", lambda topo: fake_links)
    monkeypatch.setattr(clab, "get_graph_positions_from_topo", lambda topo: fake_positions)
    monkeypatch.setattr(clab, "get_topo_file_from_container", lambda name: None)

    class FakeDriver:
        def collect(self, host, creds, node_name=None):
            return {"show running-config": "hostname r1"}

    class FakeParser:
        vendor_name = "frr"

    monkeypatch.setattr(drivers, "DRIVER_REGISTRY", {"frr": FakeDriver})
    monkeypatch.setattr(parsers, "PARSER_REGISTRY", {"frr": FakeParser})
    monkeypatch.setattr(ir_builder, "build_ir", lambda nodes, outputs, parsers, **kw: _minimal_ir())
    monkeypatch.setattr(collect_module, "_validate_ir", lambda ir: None)

    resp = client.post(
        "/api/collect",
        json={"topology_name": "collected", "clab_topology": str(topo_file)},
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["ir_version"] == "0.2.0"
    assert data["meta"]["positions"]["clab-lab-r1"] == {"x": 1.0, "y": 2.0}

    saved = tmp_path / "collected.json"
    assert saved.exists()


def test_collect_no_nodes_returns_500(client, monkeypatch):
    import collector.clab as clab
    monkeypatch.setattr(clab, "inspect_lab", lambda topo: [])

    resp = client.post(
        "/api/collect",
        json={"topology_name": "empty", "clab_topology": "lab"},
    )
    assert resp.status_code == 500
    assert "No nodes found" in resp.json()["detail"]


def test_collect_auto_detects_topo_file(client, monkeypatch, tmp_path):
    import api.routes.collect as collect_module
    import collector.clab as clab
    import collector.drivers as drivers
    import translator.ir_builder as ir_builder
    import translator.parsers as parsers

    real_topo = tmp_path / "auto.clab.yml"
    real_topo.write_text(
        "name: auto\ntopology:\n  nodes:\n    r1: {}\n  links:\n"
        "    - endpoints: [\"r1:eth1\", \"r2:eth1\"]\n"
    )

    fake_nodes = [_make_clab_node("clab-auto-r1", "frr", "10.0.0.1", "r1")]

    monkeypatch.setattr(clab, "inspect_lab", lambda topo: fake_nodes)
    monkeypatch.setattr(clab, "get_links_from_topo", lambda topo: [])
    monkeypatch.setattr(clab, "get_graph_positions_from_topo", lambda topo: {})
    monkeypatch.setattr(clab, "get_topo_file_from_container", lambda name: str(real_topo))

    class FakeDriver:
        def collect(self, host, creds, node_name=None):
            return {}

    class FakeParser:
        vendor_name = "frr"

    monkeypatch.setattr(drivers, "DRIVER_REGISTRY", {"frr": FakeDriver})
    monkeypatch.setattr(parsers, "PARSER_REGISTRY", {"frr": FakeParser})
    monkeypatch.setattr(ir_builder, "build_ir", lambda nodes, outputs, parsers, **kw: _minimal_ir())
    monkeypatch.setattr(collect_module, "_validate_ir", lambda ir: None)

    resp = client.post(
        "/api/collect",
        json={"topology_name": "auto-detect", "clab_topology": "auto"},
    )
    assert resp.status_code == 200


def test_collect_uses_request_credentials(client, monkeypatch, tmp_path):
    import api.routes.collect as collect_module
    import collector.clab as clab
    import collector.drivers as drivers
    import translator.ir_builder as ir_builder
    import translator.parsers as parsers

    topo_file = tmp_path / "creds.clab.yml"
    topo_file.write_text("name: creds\ntopology:\n  nodes:\n    r1:\n      kind: linux\n")

    fake_nodes = [_make_clab_node("clab-creds-r1", "frr", "10.0.0.1", "r1")]
    captured = {}

    class FakeDriver:
        def collect(self, host, creds, node_name=None):
            captured["creds"] = creds
            return {}

    class FakeParser:
        vendor_name = "frr"

    monkeypatch.setattr(clab, "inspect_lab", lambda topo: fake_nodes)
    monkeypatch.setattr(clab, "get_links_from_topo", lambda topo: [])
    monkeypatch.setattr(clab, "get_graph_positions_from_topo", lambda topo: {})
    monkeypatch.setattr(clab, "get_topo_file_from_container", lambda name: None)
    monkeypatch.setattr(drivers, "DRIVER_REGISTRY", {"frr": FakeDriver})
    monkeypatch.setattr(parsers, "PARSER_REGISTRY", {"frr": FakeParser})
    monkeypatch.setattr(ir_builder, "build_ir", lambda nodes, outputs, parsers, **kw: _minimal_ir())
    monkeypatch.setattr(collect_module, "_validate_ir", lambda ir: None)

    resp = client.post(
        "/api/collect",
        json={
            "topology_name": "creds-test",
            "clab_topology": str(topo_file),
            "credentials": {"username": "custom", "password": "secret"},
        },
    )
    assert resp.status_code == 200
    assert captured["creds"]["username"] == "custom"


def test_collect_skips_unknown_vendor(client, monkeypatch, tmp_path):
    import api.routes.collect as collect_module
    import collector.clab as clab
    import collector.drivers as drivers
    import translator.ir_builder as ir_builder
    import translator.parsers as parsers

    topo_file = tmp_path / "unknown.clab.yml"
    topo_file.write_text("name: unknown\ntopology:\n  nodes:\n    r1:\n      kind: linux\n")

    fake_nodes = [_make_clab_node("clab-unknown-r1", "unknown_vendor", "10.0.0.1", "r1")]

    monkeypatch.setattr(clab, "inspect_lab", lambda topo: fake_nodes)
    monkeypatch.setattr(clab, "get_links_from_topo", lambda topo: [])
    monkeypatch.setattr(clab, "get_graph_positions_from_topo", lambda topo: {})
    monkeypatch.setattr(clab, "get_topo_file_from_container", lambda name: None)
    monkeypatch.setattr(drivers, "DRIVER_REGISTRY", {})
    monkeypatch.setattr(parsers, "PARSER_REGISTRY", {})
    monkeypatch.setattr(ir_builder, "build_ir", lambda nodes, outputs, parsers, **kw: _minimal_ir())
    monkeypatch.setattr(collect_module, "_validate_ir", lambda ir: None)

    resp = client.post(
        "/api/collect",
        json={"topology_name": "unknown-test", "clab_topology": str(topo_file)},
    )
    assert resp.status_code == 200


def test_collect_driver_exception_is_logged(client, monkeypatch, tmp_path, caplog):
    import api.routes.collect as collect_module
    import collector.clab as clab
    import collector.drivers as drivers
    import translator.ir_builder as ir_builder
    import translator.parsers as parsers

    topo_file = tmp_path / "err.clab.yml"
    topo_file.write_text("name: err\ntopology:\n  nodes:\n    r1:\n      kind: linux\n")

    fake_nodes = [_make_clab_node("clab-err-r1", "frr", "10.0.0.1", "r1")]

    class FailingDriver:
        def collect(self, host, creds, node_name=None):
            raise RuntimeError("boom")

    class FakeParser:
        vendor_name = "frr"

    monkeypatch.setattr(clab, "inspect_lab", lambda topo: fake_nodes)
    monkeypatch.setattr(clab, "get_links_from_topo", lambda topo: [])
    monkeypatch.setattr(clab, "get_graph_positions_from_topo", lambda topo: {})
    monkeypatch.setattr(clab, "get_topo_file_from_container", lambda name: None)
    monkeypatch.setattr(drivers, "DRIVER_REGISTRY", {"frr": FailingDriver})
    monkeypatch.setattr(parsers, "PARSER_REGISTRY", {"frr": FakeParser})
    monkeypatch.setattr(ir_builder, "build_ir", lambda nodes, outputs, parsers, **kw: _minimal_ir())
    monkeypatch.setattr(collect_module, "_validate_ir", lambda ir: None)

    with caplog.at_level("WARNING"):
        resp = client.post(
            "/api/collect",
            json={"topology_name": "err-test", "clab_topology": str(topo_file)},
        )
    assert resp.status_code == 200
    assert any("boom" in rec.message for rec in caplog.records)


def test_collect_fallback_exception_returns_500(client, monkeypatch):
    import collector.clab as clab
    monkeypatch.setattr(clab, "inspect_lab", lambda topo: (_ for _ in ()).throw(RuntimeError("inspect failed")))

    resp = client.post(
        "/api/collect",
        json={"topology_name": "fail", "clab_topology": "lab"},
    )
    assert resp.status_code == 500
    assert "Topology collection failed" in resp.json()["detail"]
