"""Tests for plugins/generic/parser.py."""
import json

from plugins.generic.parser import GenericParser


def _addr_iface(ifname="eth0", state="UP", local="10.0.0.1", prefixlen=24, mac="00:11:22:33:44:55", mtu=1500):
    return {
        "ifname": ifname,
        "operstate": state,
        "address": mac,
        "mtu": mtu,
        "addr_info": [{"family": "inet", "local": local, "prefixlen": prefixlen}],
    }


def test_parse_interfaces_basic():
    parser = GenericParser()
    data = [_addr_iface("eth0"), _addr_iface("eth1", local="10.0.0.2")]
    outputs = {"ip -j addr": json.dumps(data)}
    ifaces = parser.parse_interfaces(outputs)

    assert len(ifaces) == 2
    assert ifaces[0]["name"] == "eth0"
    assert ifaces[0]["ip"] == "10.0.0.1/24"
    assert ifaces[0]["state"] == "up"
    assert ifaces[0]["mac"] == "00:11:22:33:44:55"
    assert ifaces[0]["mtu"] == 1500


def test_parse_interfaces_skips_loopback():
    parser = GenericParser()
    data = [{"ifname": "lo", "operstate": "UNKNOWN", "addr_info": []}]
    outputs = {"ip -j addr": json.dumps(data)}
    assert parser.parse_interfaces(outputs) == []


def test_parse_interfaces_state_down():
    parser = GenericParser()
    data = [_addr_iface("eth0", state="DOWN")]
    outputs = {"ip -j addr": json.dumps(data)}
    ifaces = parser.parse_interfaces(outputs)
    assert ifaces[0]["state"] == "down"


def test_parse_interfaces_no_ipv4():
    parser = GenericParser()
    data = [{"ifname": "eth0", "operstate": "UP", "addr_info": []}]
    outputs = {"ip -j addr": json.dumps(data)}
    ifaces = parser.parse_interfaces(outputs)
    assert ifaces[0]["ip"] is None


def test_parse_interfaces_strips_wrapping_logs():
    parser = GenericParser()
    raw = 'some log line\n' + json.dumps([_addr_iface("eth0")]) + '\nanother log'
    outputs = {"ip -j addr": raw}
    ifaces = parser.parse_interfaces(outputs)
    assert len(ifaces) == 1
    assert ifaces[0]["name"] == "eth0"


def test_parse_interfaces_invalid_json():
    parser = GenericParser()
    outputs = {"ip -j addr": "not json"}
    assert parser.parse_interfaces(outputs) == []


def test_parse_routes_basic():
    parser = GenericParser()
    data = [
        {"dst": "10.0.0.0/24", "dev": "eth0", "protocol": "kernel"},
        {"dst": "default", "gateway": "10.0.0.1", "dev": "eth0"},
    ]
    outputs = {"ip -j route": json.dumps(data)}
    routes = parser.parse_routes(outputs)["default"]

    assert len(routes) == 2
    assert routes[0]["prefix"] == "10.0.0.0/24"
    assert routes[0]["protocol"] == "connected"
    assert routes[1]["prefix"] == "0.0.0.0/0"
    assert routes[1]["next_hop"] == "10.0.0.1"
    assert routes[1]["protocol"] == "static"


def test_parse_routes_invalid_json():
    parser = GenericParser()
    outputs = {"ip -j route": "not json"}
    assert parser.parse_routes(outputs) == {"default": []}


def test_parse_routes_strips_wrapping_logs():
    parser = GenericParser()
    raw = 'log\n' + json.dumps([{"dst": "10.0.0.0/24", "dev": "eth0"}]) + '\nlog'
    outputs = {"ip -j route": raw}
    routes = parser.parse_routes(outputs)["default"]
    assert len(routes) == 1


def test_parse_acls_returns_empty():
    parser = GenericParser()
    assert parser.parse_acls({}) == {}
