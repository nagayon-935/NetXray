"""Tests for plugins/base_config_generator.py."""
from plugins.base_config_generator import BaseConfigGenerator
from translator.parser_base import AclRuleData, InterfaceData


def test_generate_interface_config_with_ip():
    gen = BaseConfigGenerator()
    desired = InterfaceData(name="eth1", state="up", ip="10.0.0.1/24")
    cmds = gen.generate_interface_config("eth1", None, desired)
    assert "interface eth1" in cmds
    assert " ip address 10.0.0.1/24" in cmds
    assert " no shutdown" in cmds


def test_generate_interface_config_shutdown():
    gen = BaseConfigGenerator()
    desired = InterfaceData(name="eth1", state="down")
    cmds = gen.generate_interface_config("eth1", None, desired)
    assert " shutdown" in cmds
    assert " no shutdown" not in cmds


def test_generate_interface_config_acl_in_added():
    gen = BaseConfigGenerator()
    desired = InterfaceData(name="eth1", state="up", acl_in="ACL1")
    cmds = gen.generate_interface_config("eth1", None, desired)
    assert " ip access-group ACL1 in" in cmds


def test_generate_interface_config_acl_in_removed():
    gen = BaseConfigGenerator()
    current = InterfaceData(name="eth1", state="up", acl_in="ACL1")
    desired = InterfaceData(name="eth1", state="up")
    cmds = gen.generate_interface_config("eth1", current, desired)
    assert " no ip access-group ACL1 in" in cmds


def test_generate_interface_config_acl_out_added():
    gen = BaseConfigGenerator()
    desired = InterfaceData(name="eth1", state="up", acl_out="ACL2")
    cmds = gen.generate_interface_config("eth1", None, desired)
    assert " ip access-group ACL2 out" in cmds


def test_generate_acl_config():
    gen = BaseConfigGenerator()
    rules = [
        AclRuleData(seq=10, action="permit", protocol="ip", src="any", dst="any"),
        AclRuleData(seq=20, action="deny", protocol="tcp", src="10.0.0.0/8", dst="any", dst_port=80),
    ]
    cmds = gen.generate_acl_config("ACL1", rules)
    assert cmds[0] == "ip access-list ACL1"
    assert " 10 permit ip any any" in cmds
    assert " 20 deny tcp 10.0.0.0/8 any eq 80" in cmds


def test_generate_bgp_config_default_empty():
    gen = BaseConfigGenerator()
    assert gen.generate_bgp_config({}) == []


def test_generate_startup_config():
    gen = BaseConfigGenerator()
    node = {
        "id": "r1",
        "hostname": "Router1",
        "interfaces": {
            "eth0": {"ip": "10.0.0.1/24", "state": "up"},
            "eth1": {"state": "down"},
        },
    }
    config = gen.generate_startup_config(node)
    assert "hostname Router1" in config
    assert "interface eth0" in config
    assert " ip address 10.0.0.1/24" in config
    assert "interface eth1" in config
    assert " shutdown" in config


def test_generate_startup_config_uses_id_fallback():
    gen = BaseConfigGenerator()
    node = {"id": "r1", "interfaces": {}}
    config = gen.generate_startup_config(node)
    assert "hostname r1" in config


def test_generate_startup_config_bgp():
    gen = BaseConfigGenerator()
    gen.generate_bgp_config = lambda bgp: ["router bgp 65001"]
    node = {
        "id": "r1",
        "interfaces": {},
        "bgp": {"asn": 65001},
    }
    config = gen.generate_startup_config(node)
    assert "router bgp 65001" in config


def test_generate_full_diff_template():
    gen = BaseConfigGenerator()
    base = {
        "interfaces": {
            "eth0": {"name": "eth0", "ip": "10.0.0.1/24", "state": "up"},
        }
    }
    target = {
        "interfaces": {
            "eth0": {"name": "eth0", "ip": "10.0.0.2/24", "state": "up"},
        }
    }
    cmds = gen._generate_full_diff_template(base, target, ["conf t"], ["end"])
    assert "conf t" in cmds
    assert "interface eth0" in cmds
    assert " ip address 10.0.0.2/24" in cmds
    assert "end" in cmds


def test_generate_full_diff_template_legacy_list_format():
    gen = BaseConfigGenerator()
    base = {"interfaces": [{"name": "eth0", "ip": "10.0.0.1/24", "state": "up"}]}
    target = {"interfaces": [{"name": "eth0", "ip": "10.0.0.2/24", "state": "up"}]}
    cmds = gen._generate_full_diff_template(base, target, [], [])
    assert "interface eth0" in cmds


def test_generate_full_diff_template_bgp_diff():
    gen = BaseConfigGenerator()
    gen.generate_bgp_config = lambda bgp: [f"router bgp {bgp['asn']}"]
    base = {"interfaces": {}, "bgp": {"asn": 65001}}
    target = {"interfaces": {}, "bgp": {"asn": 65002}}
    cmds = gen._generate_full_diff_template(base, target, [], [])
    assert "router bgp 65002" in cmds
