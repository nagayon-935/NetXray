"""Tests for translator.clab_yaml_importer: static YAML -> IR."""

from pathlib import Path

import pytest

from translator.clab_yaml_importer import import_from_yaml


SIMPLE_CLAB_YAML = """
name: test-lab
topology:
  nodes:
    r1:
      kind: linux
      image: quay.io/frrouting/frr:latest
    r2:
      kind: linux
      image: quay.io/frrouting/frr:latest
    r3:
      kind: ceos
      image: ceos:4.32.0F
  links:
    - endpoints: ["r1:eth1", "r2:eth1"]
    - endpoints: ["r2:eth2", "r3:Ethernet1"]
"""


def test_imports_nodes_and_links():
    ir = import_from_yaml(SIMPLE_CLAB_YAML)
    assert ir["ir_version"] == "0.2.0"
    nodes = {n["id"]: n for n in ir["topology"]["nodes"]}
    assert set(nodes.keys()) == {"r1", "r2", "r3"}
    assert nodes["r1"]["vendor"] == "frr"
    assert nodes["r3"]["vendor"] == "arista"
    assert len(ir["topology"]["links"]) == 2


def test_interfaces_derived_from_link_endpoints():
    ir = import_from_yaml(SIMPLE_CLAB_YAML)
    nodes = {n["id"]: n for n in ir["topology"]["nodes"]}
    assert "eth1" in nodes["r1"]["interfaces"]
    assert "eth1" in nodes["r2"]["interfaces"]
    assert "eth2" in nodes["r2"]["interfaces"]
    assert "Ethernet1" in nodes["r3"]["interfaces"]


def test_raw_config_attached_when_bind_exists(tmp_path: Path):
    """If binds: points to a real config file on disk, it should be read."""
    frr_conf = tmp_path / "r1_frr.conf"
    frr_conf.write_text(
        "!\nrouter bgp 65001\n bgp router-id 10.0.0.1\n neighbor 10.0.0.2 remote-as 65002\n!\n"
    )
    yaml_text = f"""
name: bind-lab
topology:
  nodes:
    r1:
      kind: linux
      image: frr:latest
      binds:
        - {frr_conf}:/etc/frr/frr.conf
  links: []
"""
    ir = import_from_yaml(yaml_text, base_dir=tmp_path)
    node = ir["topology"]["nodes"][0]
    assert "raw_config" in node
    assert "router bgp 65001" in node["raw_config"]
    # parse_bgp populates node.bgp
    assert node.get("bgp", {}).get("local_as") == 65001


def test_empty_yaml_returns_empty_topology():
    ir = import_from_yaml("")
    assert ir["topology"]["nodes"] == []
    assert ir["topology"]["links"] == []


def test_invalid_yaml_raises_value_error():
    with pytest.raises(ValueError):
        import_from_yaml("name: test\n  bad: [unclosed")
