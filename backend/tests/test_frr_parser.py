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
