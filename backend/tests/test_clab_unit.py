"""Unit tests for collector/clab.py."""
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from collector import clab


FIXTURES = Path(__file__).parent / "fixtures"


def test_detect_vendor_frr():
    assert clab._detect_vendor("frrouting/frr", "linux") == "frr"
    assert clab._detect_vendor("someimage", "frr") == "frr"


def test_detect_vendor_arista():
    assert clab._detect_vendor("arista/ceos", "arista_ceos") == "arista"
    assert clab._detect_vendor("ceos", "linux") == "arista"
    assert clab._detect_vendor("aristaimage", "ceoslab") == "arista"


def test_detect_vendor_cisco_xr():
    assert clab._detect_vendor("xrd", "cisco_xrd") == "cisco_xr"
    assert clab._detect_vendor("cisco/xrd", "linux") == "cisco_xr"


def test_detect_vendor_juniper():
    assert clab._detect_vendor("juniper_vjunos", "linux") == "juniper_junos"
    assert clab._detect_vendor("someimage", "juniper_vjunos") == "juniper_junos"


def test_detect_vendor_generic():
    assert clab._detect_vendor("alpine", "linux") == "generic"
    assert clab._detect_vendor("mystery", "unknown") == "generic"


@patch("collector.clab.subprocess.run")
def test_inspect_lab_top_level_list(mock_run):
    data = [
        {"name": "clab-lab-r1", "image": "frrouting/frr", "kind": "linux", "state": "running", "ipv4_address": "172.20.0.2"}
    ]
    mock_run.return_value = MagicMock(stdout=json.dumps(data))
    nodes = clab.inspect_lab()
    assert len(nodes) == 1
    assert nodes[0].vendor == "frr"


@patch("collector.clab.subprocess.run")
def test_inspect_lab_containers_key(mock_run):
    data = {
        "containers": [
            {"name": "clab-lab-r2", "image": "ceos", "kind": "arista_ceos", "state": "running", "mgmt_ipv4_address": "172.20.0.3"}
        ]
    }
    mock_run.return_value = MagicMock(stdout=json.dumps(data))
    nodes = clab.inspect_lab()
    assert len(nodes) == 1
    assert nodes[0].vendor == "arista"


@patch("collector.clab.subprocess.run")
def test_inspect_lab_lab_name_key(mock_run):
    data = {
        "lab1": [
            {"name": "clab-lab1-r1", "image": "frrouting/frr", "kind": "linux", "state": "running", "ip_address": "10.0.0.1/24"}
        ]
    }
    mock_run.return_value = MagicMock(stdout=json.dumps(data))
    nodes = clab.inspect_lab()
    assert len(nodes) == 1
    assert nodes[0].mgmt_ip == "10.0.0.1"


@patch("collector.clab.subprocess.run")
def test_inspect_lab_short_name_from_label(mock_run):
    data = {
        "containers": [
            {
                "name": "clab-lab-r1",
                "image": "frrouting/frr",
                "kind": "linux",
                "state": "running",
                "ipv4_address": "172.20.0.2",
                "labels": {"clab-node-name": "r1"},
            }
        ]
    }
    mock_run.return_value = MagicMock(stdout=json.dumps(data))
    nodes = clab.inspect_lab()
    assert nodes[0].short_name == "r1"


@patch("collector.clab.subprocess.run")
def test_inspect_lab_short_name_fallback(mock_run):
    data = {
        "containers": [
            {
                "name": "clab-mylab-router1",
                "image": "frrouting/frr",
                "kind": "linux",
                "state": "running",
                "ipv4_address": "172.20.0.2",
                "lab_name": "mylab",
            }
        ]
    }
    mock_run.return_value = MagicMock(stdout=json.dumps(data))
    nodes = clab.inspect_lab()
    assert nodes[0].short_name == "router1"


@patch("collector.clab.subprocess.run")
def test_inspect_lab_skips_missing_mgmt_ip(mock_run):
    data = {"containers": [{"name": "r1", "image": "frrouting/frr", "kind": "linux", "state": "running"}]}
    mock_run.return_value = MagicMock(stdout=json.dumps(data))
    nodes = clab.inspect_lab()
    assert len(nodes) == 0


@patch("collector.clab.subprocess.run")
def test_inspect_lab_passes_topology_file(mock_run, tmp_path):
    data = []
    mock_run.return_value = MagicMock(stdout=json.dumps(data))
    topo_file = tmp_path / "lab.clab.yml"
    topo_file.write_text("name: lab\n")
    clab.inspect_lab(str(topo_file))
    cmd = mock_run.call_args[0][0]
    assert "--topo" in cmd
    assert str(topo_file) in cmd


@patch("collector.clab.subprocess.run")
def test_inspect_lab_passes_lab_name(mock_run):
    data = []
    mock_run.return_value = MagicMock(stdout=json.dumps(data))
    clab.inspect_lab("mylab")
    cmd = mock_run.call_args[0][0]
    assert "--name" in cmd
    assert "mylab" in cmd


def test_inspect_lab_file_not_found():
    with patch("collector.clab.subprocess.run", side_effect=FileNotFoundError()):
        with pytest.raises(RuntimeError, match="containerlab binary not found"):
            clab.inspect_lab()


def test_inspect_lab_timeout():
    import subprocess
    with patch("collector.clab.subprocess.run", side_effect=subprocess.TimeoutExpired("cmd", 30)):
        with pytest.raises(RuntimeError, match="timed out"):
            clab.inspect_lab()


def test_inspect_lab_called_process_error():
    import subprocess
    exc = subprocess.CalledProcessError(1, "cmd", stderr="bad topology")
    with patch("collector.clab.subprocess.run", side_effect=exc):
        with pytest.raises(RuntimeError, match="failed"):
            clab.inspect_lab()


def test_inspect_lab_empty_output():
    with patch("collector.clab.subprocess.run", return_value=MagicMock(stdout="", stderr="oops")):
        with pytest.raises(RuntimeError, match="empty output"):
            clab.inspect_lab()


def test_inspect_lab_bad_json():
    with patch("collector.clab.subprocess.run", return_value=MagicMock(stdout="not json")):
        with pytest.raises(RuntimeError, match="Failed to parse"):
            clab.inspect_lab()


@pytest.mark.asyncio
async def test_stream_docker_events_yields_states(monkeypatch):
    import asyncio

    class FakeProc:
        returncode = None
        stdout = asyncio.StreamReader()

    fake_proc = FakeProc()
    fake_proc.stdout.feed_data(json.dumps({"Action": "start", "Actor": {"Attributes": {"clab-node-name": "r1"}}}).encode() + b"\n")
    fake_proc.stdout.feed_data(json.dumps({"Action": "stop", "Actor": {"Attributes": {"clab-node-name": "r2"}}}).encode() + b"\n")
    fake_proc.stdout.feed_eof()

    async def fake_create(*args, **kwargs):
        return fake_proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    events = []
    async for node_id, state in clab.stream_docker_events("lab"):
        events.append((node_id, state))
    assert events == [("r1", "running"), ("r2", "stopped")]


@pytest.mark.asyncio
async def test_stream_docker_events_file_not_found(monkeypatch):
    import asyncio

    async def fake_create(*args, **kwargs):
        raise FileNotFoundError()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    events = []
    async for item in clab.stream_docker_events("lab"):
        events.append(item)
    assert events == []


@patch("collector.clab.subprocess.run")
def test_exec_node_success(mock_run):
    mock_run.return_value = MagicMock(stdout="output1")
    results = clab.exec_node("r1", ["cmd1", "cmd2"])
    assert results == {"cmd1": "output1", "cmd2": "output1"}
    cmd = mock_run.call_args[0][0]
    assert cmd[0] == "containerlab"
    assert "clab-node-name=r1" in cmd


@patch("collector.clab.subprocess.run")
def test_exec_node_failure(mock_run):
    mock_run.side_effect = RuntimeError("exec failed")
    results = clab.exec_node("r1", ["cmd1"])
    assert "ERROR" in results["cmd1"]


@patch("collector.clab.subprocess.run")
def test_get_topo_file_from_container_success(mock_run):
    import tempfile
    with tempfile.NamedTemporaryFile(mode="w", suffix=".clab.yml", delete=False) as f:
        f.write("name: t\n")
        path = f.name
    mock_run.return_value = MagicMock(stdout=path)
    assert clab.get_topo_file_from_container("r1") == path
    import os
    os.unlink(path)


@patch("collector.clab.subprocess.run")
def test_get_topo_file_from_container_not_a_file(mock_run, tmp_path):
    path = str(tmp_path / "missing.clab.yml")
    mock_run.return_value = MagicMock(stdout=path)
    assert clab.get_topo_file_from_container("r1") is None


@patch("collector.clab.subprocess.run")
def test_get_topo_file_from_container_no_label(mock_run):
    mock_run.return_value = MagicMock(stdout="\n")
    assert clab.get_topo_file_from_container("r1") is None


@patch("collector.clab.subprocess.run")
def test_get_topo_file_from_container_called_process_error(mock_run):
    import subprocess
    mock_run.side_effect = subprocess.CalledProcessError(1, "cmd")
    assert clab.get_topo_file_from_container("r1") is None


def test_get_graph_positions_from_topo(tmp_path):
    topo = tmp_path / "pos.clab.yml"
    topo.write_text(
        "name: pos\ntopology:\n  nodes:\n"
        "    r1:\n      labels:\n        graph-posX: 10\n        graph-posY: 20\n"
        "    r2:\n      labels:\n        graph-posX: 30\n        graph-posY: 40\n"
    )
    positions = clab.get_graph_positions_from_topo(str(topo))
    assert positions == {"r1": {"x": 10.0, "y": 20.0}, "r2": {"x": 30.0, "y": 40.0}}


def test_get_graph_positions_from_topo_missing(tmp_path):
    topo = tmp_path / "pos.clab.yml"
    topo.write_text("name: pos\ntopology:\n  nodes:\n    r1: {}\n")
    assert clab.get_graph_positions_from_topo(str(topo)) == {}


def test_get_graph_positions_from_topo_invalid_path():
    assert clab.get_graph_positions_from_topo("/nonexistent") == {}


def test_get_links_from_topo(tmp_path):
    topo = tmp_path / "links.clab.yml"
    topo.write_text(
        "name: links\ntopology:\n  nodes:\n    r1: {}\n    r2: {}\n"
        "  links:\n    - endpoints: [\"r1:eth1\", \"r2:eth1\"]\n"
        "    - endpoints: [\"r1:eth2\", \"r2:eth2\", \"r3:eth1\"]\n"
        "    - endpoints: \"bad\"\n"
    )
    links = clab.get_links_from_topo(str(topo))
    assert len(links) == 1
    assert links[0].source_node == "r1"
    assert links[0].target_node == "r2"


def test_get_links_from_topo_invalid_path():
    assert clab.get_links_from_topo("/nonexistent") == []
