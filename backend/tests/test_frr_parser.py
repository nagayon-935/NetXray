from plugins.frr.parser import FrrParser


def test_parse_interfaces(frr_outputs):
    parser = FrrParser()
    ifaces = parser.parse_interfaces(frr_outputs)
    names = [i["name"] for i in ifaces]
    assert "eth0" in names
    assert "eth1" in names
    eth0 = next(i for i in ifaces if i["name"] == "eth0")
    assert eth0["ip"] == "10.0.12.1/30"
    assert eth0["state"] == "up"


def test_parse_routes(frr_outputs):
    parser = FrrParser()
    vrfs = parser.parse_routes(frr_outputs)
    routes = vrfs["default"]
    protocols = {r["protocol"] for r in routes}
    assert "connected" in protocols
    assert "ospf" in protocols
    assert "bgp" in protocols


def test_parse_acls(frr_outputs):
    parser = FrrParser()
    acls = parser.parse_acls(frr_outputs)
    assert "ACL_BLOCK_SSH" in acls
    assert "ACL_WEB_ONLY" in acls
    ssh_rules = acls["ACL_BLOCK_SSH"]
    assert ssh_rules[0]["seq"] == 10
    assert ssh_rules[0]["action"] == "deny"
    assert ssh_rules[0]["protocol"] == "tcp"
    assert ssh_rules[0]["dst_port"] == 22


def test_parse_bgp(frr_outputs):
    parser = FrrParser()
    bgp = parser.parse_bgp(frr_outputs)
    assert bgp is not None
    assert bgp["local_as"] == 65001
    assert bgp["router_id"] == "1.1.1.1"
    peers = {s["peer_ip"]: s for s in bgp["sessions"]}
    assert set(peers) == {"10.0.12.2", "10.0.13.2"}
    assert peers["10.0.12.2"]["remote_as"] == 65002
    assert peers["10.0.12.2"]["state"] == "unknown"
    # address-family tagging
    assert "ipv4_unicast" in peers["10.0.12.2"]["address_families"]


def test_parse_bgp_absent():
    parser = FrrParser()
    assert parser.parse_bgp({"show running-config": "hostname R1\n!\n"}) is None


def test_parse_ospf(frr_outputs):
    parser = FrrParser()
    ospf = parser.parse_ospf(frr_outputs)
    assert ospf is not None
    assert ospf["router_id"] == "1.1.1.1"
    iface_map = {i["name"]: i for i in ospf["interfaces"]}
    assert "eth0" in iface_map
    assert iface_map["eth0"]["area"] == "0"
    assert iface_map["eth0"]["cost"] == 10
    assert iface_map["eth1"]["area"] == "0"


def test_parse_ospf_absent():
    parser = FrrParser()
    assert parser.parse_ospf({"show running-config": "hostname R1\n!\n"}) is None


def test_kernel_routes_excluded(frr_outputs):
    """Kernel routes should be filtered out."""
    import json
    outputs = {
        **frr_outputs,
        "show ip route json": json.dumps({
            "0.0.0.0/0": [{"protocol": "kernel", "nexthops": [{"ip": "10.0.0.1", "interfaceName": "eth0"}]}]
        }),
    }
    parser = FrrParser()
    vrfs = parser.parse_routes(outputs)
    assert len(vrfs.get("default", [])) == 0
