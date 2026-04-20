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


def test_parse_bgp(arista_outputs):
    parser = AristaParser()
    bgp = parser.parse_bgp(arista_outputs)
    assert bgp is not None
    assert bgp["local_as"] == 65002
    assert bgp["router_id"] == "2.2.2.2"
    peers = {s["peer_ip"]: s for s in bgp["sessions"]}
    assert set(peers) == {"10.0.12.1", "10.0.23.3"}
    assert peers["10.0.12.1"]["remote_as"] == 65001
    assert peers["10.0.12.1"]["state"] == "unknown"
    assert "ipv4" in peers["10.0.12.1"]["address_families"]


def test_parse_bgp_absent():
    parser = AristaParser()
    assert parser.parse_bgp({"show running-config": "hostname R2\n!\n"}) is None


def test_parse_ospf(arista_outputs):
    parser = AristaParser()
    ospf = parser.parse_ospf(arista_outputs)
    assert ospf is not None
    assert ospf["router_id"] == "2.2.2.2"
    assert ospf["process_id"] == 1
    iface_map = {i["name"]: i for i in ospf["interfaces"]}
    assert "Ethernet1" in iface_map
    assert iface_map["Ethernet1"]["area"] == "0.0.0.0"
    assert iface_map["Ethernet1"]["cost"] == 10


def test_parse_ospf_absent():
    parser = AristaParser()
    assert parser.parse_ospf({"show running-config": "hostname R2\n!\n"}) is None
