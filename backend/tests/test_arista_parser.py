from plugins.arista.parser import AristaParser


def test_parse_interfaces(arista_outputs):
    parser = AristaParser()
    ifaces = parser.parse_interfaces(arista_outputs)
    names = [i["name"] for i in ifaces]
    assert "Ethernet1" in names
    assert "Ethernet2" in names
    eth1 = next(i for i in ifaces if i["name"] == "Ethernet1")
    assert eth1["ip"] == "10.0.12.2/30"
    assert eth1["state"] == "up"


def test_parse_routes(arista_outputs):
    parser = AristaParser()
    vrfs = parser.parse_routes(arista_outputs)
    routes = vrfs["default"]
    protocols = {r["protocol"] for r in routes}
    assert "connected" in protocols
    assert "bgp" in protocols


def test_parse_acls(arista_outputs):
    parser = AristaParser()
    acls = parser.parse_acls(arista_outputs)
    assert "ACL_SERVER_PROTECT" in acls
    rules = acls["ACL_SERVER_PROTECT"]
    assert len(rules) == 3
    deny_rule = next(r for r in rules if r["action"] == "deny")
    assert deny_rule["seq"] == 30


def test_route_type_mapping(arista_outputs):
    parser = AristaParser()
    vrfs = parser.parse_routes(arista_outputs)
    bgp_routes = [r for r in vrfs["default"] if r["protocol"] == "bgp"]
    assert any(r["prefix"] == "1.1.1.1/32" for r in bgp_routes)
