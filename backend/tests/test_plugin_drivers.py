"""Tests for FRR, Arista, and Generic drivers."""
import json
from unittest.mock import MagicMock, patch

import pytest

from plugins.arista.driver import AristaDriver
from plugins.frr.driver import FrrDriver
from plugins.generic.driver import GenericDriver


@patch("subprocess.run")
def test_frr_driver_collect_via_node_name(mock_run):
    mock_run.return_value = MagicMock(stdout='{"interface": "eth0"}')
    driver = FrrDriver()
    outputs = driver.collect("", {}, node_name="clab-lab-r1")

    assert "show interface json" in outputs
    assert json.loads(outputs["show interface json"]) == {"interface": "eth0"}
    cmd = mock_run.call_args[0][0]
    assert cmd[0] == "docker"
    assert cmd[2] == "clab-lab-r1"


@patch("subprocess.run")
def test_frr_driver_collect_via_node_name_failure(mock_run):
    mock_run.side_effect = RuntimeError("exec failed")
    driver = FrrDriver()
    outputs = driver.collect("", {}, node_name="clab-lab-r1")

    assert "ERROR" in outputs["show interface json"]


@patch("collector.ssh_client.execute_commands")
def test_frr_driver_collect_via_ssh(mock_exec):
    mock_exec.return_value = {
        'vtysh -c "show interface json"': "{}",
        'vtysh -c "show ip route json"': "{}",
        'vtysh -c "show ip route vrf all json"': "{}",
        'vtysh -c "show ip bgp json"': "{}",
        'vtysh -c "show running-config"': "hostname r1",
    }
    driver = FrrDriver()
    outputs = driver.collect("10.0.0.1", {"username": "root", "password": "frr"})

    assert outputs["show running-config"] == "hostname r1"
    call_kwargs = mock_exec.call_args[1]
    assert call_kwargs["host"] == "10.0.0.1"
    assert call_kwargs["device_type"] == "linux"


def test_frr_driver_vendor_name():
    assert FrrDriver.vendor_name() == "frr"


@patch("plugins.arista.driver.httpx.post")
@patch("collector.ssh_client.execute_commands")
def test_arista_driver_collect_eapi_success(mock_ssh, mock_post):
    json_response = MagicMock()
    json_response.json.return_value = {"result": [{"interfaces": {}}]}
    json_response.raise_for_status = MagicMock()

    text_response = MagicMock()
    text_response.json.return_value = {"result": [{"output": "hostname r2"}]}
    text_response.raise_for_status = MagicMock()

    mock_post.side_effect = [json_response, text_response]

    driver = AristaDriver()
    outputs = driver.collect("10.0.0.2", {"username": "admin", "password": "admin"})

    assert "show interfaces" in outputs
    assert outputs["show running-config"] == "hostname r2"
    assert mock_post.call_count == 2
    mock_ssh.assert_not_called()


@patch("plugins.arista.driver.httpx.post")
@patch("collector.ssh_client.execute_commands")
def test_arista_driver_collect_eapi_error_falls_back_ssh(mock_ssh, mock_post):
    mock_post.side_effect = RuntimeError("eAPI down")
    mock_ssh.return_value = {
        "show interfaces | json": "{}",
        "show ip route | json": "{}",
        "show ip route vrf all | json": "{}",
        "show ip access-lists | json": "{}",
        "show running-config": "hostname r2",
    }

    driver = AristaDriver()
    outputs = driver.collect("10.0.0.2", {"username": "admin", "password": "admin"})

    assert outputs["show running-config"] == "hostname r2"
    mock_ssh.assert_called_once()


@patch("plugins.arista.driver.httpx.post")
@patch("collector.ssh_client.execute_commands")
def test_arista_driver_collect_eapi_error_ssh_also_fails(mock_ssh, mock_post):
    response = MagicMock()
    response.json.return_value = {"error": "command failed"}
    response.raise_for_status = MagicMock()
    mock_post.return_value = response
    mock_ssh.side_effect = RuntimeError("ssh failed")

    driver = AristaDriver()
    with pytest.raises(RuntimeError):
        driver.collect("10.0.0.2", {"username": "admin", "password": "admin"})

    mock_ssh.assert_called_once()


def test_arista_driver_vendor_name():
    assert AristaDriver.vendor_name() == "arista"


@patch("subprocess.run")
def test_generic_driver_collect_via_node_name(mock_run):
    mock_run.return_value = MagicMock(stdout='[{"ifname": "eth0"}]')
    driver = GenericDriver()
    outputs = driver.collect("", {}, node_name="clab-lab-h1")

    assert "ip -j addr" in outputs
    cmd = mock_run.call_args[0][0]
    assert cmd[0] == "docker"
    assert cmd[2] == "clab-lab-h1"


@patch("subprocess.run")
def test_generic_driver_collect_failure_returns_empty_list(mock_run):
    mock_run.side_effect = RuntimeError("exec failed")
    driver = GenericDriver()
    outputs = driver.collect("", {}, node_name="clab-lab-h1")

    assert outputs["ip -j addr"] == "[]"
    assert outputs["ip -j route"] == "[]"


def test_generic_driver_no_node_name_returns_empty():
    driver = GenericDriver()
    assert driver.collect("10.0.0.1", {}) == {}


def test_generic_driver_vendor_name():
    assert GenericDriver.vendor_name() == "generic"
