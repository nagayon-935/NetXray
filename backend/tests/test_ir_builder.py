import json
from pathlib import Path
from unittest.mock import patch

from collector.clab import ClabNode
from translator.ir_builder import build_ir
from translator.parsers import PARSER_REGISTRY


def make_nodes():
    return [
        ClabNode(name="r1", mgmt_ip="172.20.0.2", vendor="frr", state="running"),
        ClabNode(name="r2", mgmt_ip="172.20.0.3", vendor="arista", state="running"),
    ]


FIXTURES = Path(__file__).parent / "fixtures"


def make_outputs():
    return {
        "r1": {
            "show interface json": (FIXTURES / "frr_show_interface.json").read_text(),
            "show ip route json": (FIXTURES / "frr_show_ip_route.json").read_text(),
            "show running-config": (FIXTURES / "frr_running_config.txt").read_text(),
        },
        "r2": {
            "show interfaces": (FIXTURES / "arista_show_interfaces.json").read_text(),
            "show ip route": (FIXTURES / "arista_show_ip_route.json").read_text(),
            "show ip access-lists": (FIXTURES / "arista_show_ip_access_lists.json").read_text(),
            "show running-config": (FIXTURES / "arista_running_config.txt").read_text(),
        },
    }


def test_build_ir_structure():
    ir = build_ir(make_nodes(), make_outputs(), PARSER_REGISTRY)
    assert ir["ir_version"] == "0.1.0"
    assert "topology" in ir
    assert "policies" in ir


def test_node_count():
    ir = build_ir(make_nodes(), make_outputs(), PARSER_REGISTRY)
    assert len(ir["topology"]["nodes"]) == 2


def test_link_inferred():
    ir = build_ir(make_nodes(), make_outputs(), PARSER_REGISTRY)
    # r1 eth0=10.0.12.1/30 and r2 Ethernet1=10.0.12.2/30 share /30 subnet
    links = ir["topology"]["links"]
    assert len(links) >= 1
    node_pairs = {
        frozenset((l["source"]["node"], l["target"]["node"])) for l in links
    }
    assert frozenset(("r1", "r2")) in node_pairs


def test_acls_merged():
    ir = build_ir(make_nodes(), make_outputs(), PARSER_REGISTRY)
    acls = ir["policies"]["acls"]
    # FRR ACLs
    assert "ACL_BLOCK_SSH" in acls
    # Arista ACLs
    assert "ACL_SERVER_PROTECT" in acls


def test_bgp_populated():
    ir = build_ir(make_nodes(), make_outputs(), PARSER_REGISTRY)
    nodes = {n["id"]: n for n in ir["topology"]["nodes"]}
    assert nodes["r1"]["bgp"]["local_as"] == 65001
    assert nodes["r2"]["bgp"]["local_as"] == 65002


def test_ospf_populated():
    ir = build_ir(make_nodes(), make_outputs(), PARSER_REGISTRY)
    nodes = {n["id"]: n for n in ir["topology"]["nodes"]}
    assert nodes["r1"]["ospf"]["router_id"] == "1.1.1.1"
    assert nodes["r2"]["ospf"]["router_id"] == "2.2.2.2"


def test_raw_config_preserved():
    ir = build_ir(make_nodes(), make_outputs(), PARSER_REGISTRY)
    nodes = {n["id"]: n for n in ir["topology"]["nodes"]}
    assert "router bgp 65001" in nodes["r1"]["raw_config"]
    assert "router bgp 65002" in nodes["r2"]["raw_config"]


def test_schema_validation():
    """Generated IR must pass jsonschema validation."""
    import jsonschema
    schema_path = Path(__file__).parent.parent.parent / "schema" / "netxray-ir.schema.json"
    if not schema_path.exists():
        return  # skip if schema not found
    schema = json.loads(schema_path.read_text())
    ir = build_ir(make_nodes(), make_outputs(), PARSER_REGISTRY)
    jsonschema.validate(ir, schema)  # raises on failure
