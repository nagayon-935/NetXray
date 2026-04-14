"""Tests for config generator (Phase 7)."""
import pytest
from plugins.frr.config_generator import FrrConfigGenerator
from plugins.arista.config_generator import AristaConfigGenerator
from plugins import get_plugin


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_node(node_id, interfaces=None, bgp=None, vendor="frr"):
    return {
        "id": node_id,
        "type": "router",
        "vendor": vendor,
        "interfaces": interfaces or {},
        "bgp": bgp,
    }


# ─── FRR Config Generator ────────────────────────────────────────────────────

class TestFrrConfigGenerator:
    def setup_method(self):
        self.gen = FrrConfigGenerator()

    def test_generate_interface_no_change(self):
        iface = {"ip": "10.0.0.1/30", "state": "up", "acl_in": None, "acl_out": None}
        cmds = self.gen.generate_interface_config("eth0", iface, iface)
        assert "interface eth0" in cmds

    def test_generate_interface_shutdown(self):
        desired = {"ip": "10.0.0.1/30", "state": "down"}
        cmds = self.gen.generate_interface_config("eth0", None, desired)
        assert " shutdown" in cmds

    def test_generate_interface_no_shutdown(self):
        desired = {"ip": "10.0.0.1/30", "state": "up"}
        cmds = self.gen.generate_interface_config("eth0", None, desired)
        assert " no shutdown" in cmds

    def test_generate_interface_adds_acl(self):
        desired = {"ip": "10.0.0.1/30", "state": "up", "acl_in": "ACL_MGMT"}
        cmds = self.gen.generate_interface_config("eth0", None, desired)
        assert " ip access-group ACL_MGMT in" in cmds

    def test_generate_interface_removes_acl(self):
        current = {"ip": "10.0.0.1/30", "state": "up", "acl_in": "OLD_ACL"}
        desired = {"ip": "10.0.0.1/30", "state": "up", "acl_in": None}
        cmds = self.gen.generate_interface_config("eth0", current, desired)
        assert " no ip access-group OLD_ACL in" in cmds

    def test_generate_bgp_config(self):
        bgp = {
            "local_as": 65000,
            "router_id": "1.1.1.1",
            "sessions": [
                {"peer_ip": "10.0.0.2", "remote_as": 65001, "state": "established"},
            ],
        }
        cmds = self.gen.generate_bgp_config(bgp)
        assert "router bgp 65000" in cmds
        assert " bgp router-id 1.1.1.1" in cmds
        assert " neighbor 10.0.0.2 remote-as 65001" in cmds

    def test_full_diff_no_change_returns_wrapper_only(self):
        node = make_node("r1", interfaces={
            "eth0": {"ip": "10.0.0.1/30", "state": "up"},
        })
        cmds = self.gen.generate_full_diff(node, node)
        # No interface changes — only start/end wrappers
        assert "conf t" in cmds
        assert "end" in cmds
        # No interface block since nothing changed
        assert not any("interface" in c for c in cmds)

    def test_full_diff_detects_interface_change(self):
        base = make_node("r1", interfaces={
            "eth0": {"ip": "10.0.0.1/30", "state": "up"},
        })
        target = make_node("r1", interfaces={
            "eth0": {"ip": "10.0.0.1/30", "state": "down"},  # state changed
        })
        cmds = self.gen.generate_full_diff(base, target)
        assert "interface eth0" in cmds
        assert " shutdown" in cmds

    def test_full_diff_includes_bgp_when_changed(self):
        base = make_node("r1", bgp={"local_as": 65000, "router_id": "1.1.1.1", "sessions": []})
        target = make_node("r1", bgp={
            "local_as": 65000,
            "router_id": "1.1.1.1",
            "sessions": [{"peer_ip": "10.0.0.2", "remote_as": 65001, "state": "established"}],
        })
        cmds = self.gen.generate_full_diff(base, target)
        assert "router bgp 65000" in cmds


# ─── Arista Config Generator ─────────────────────────────────────────────────

class TestAristaConfigGenerator:
    def setup_method(self):
        self.gen = AristaConfigGenerator()

    def test_uses_configure_terminal(self):
        base = make_node("r1")
        target = make_node("r1", interfaces={
            "Ethernet1": {"ip": "10.0.0.1/30", "state": "up"},
        })
        cmds = self.gen.generate_full_diff(base, target)
        assert "configure terminal" in cmds
        assert "copy running-config startup-config" in cmds

    def test_bgp_uses_router_id_not_bgp_prefix(self):
        bgp = {"local_as": 65100, "router_id": "2.2.2.2", "sessions": []}
        cmds = self.gen.generate_bgp_config(bgp)
        assert "router bgp 65100" in cmds
        assert " router-id 2.2.2.2" in cmds  # Arista style (no "bgp" prefix)


# ─── Plugin Discovery ────────────────────────────────────────────────────────

class TestPluginDiscovery:
    def test_frr_plugin_discoverable(self):
        plugin = get_plugin("frr")
        assert plugin is not None
        assert plugin.vendor_name == "frr"
        assert plugin.config_generator_class is not None

    def test_arista_plugin_discoverable(self):
        plugin = get_plugin("arista")
        assert plugin is not None
        assert plugin.vendor_name == "arista"

    def test_unknown_vendor_returns_none(self):
        plugin = get_plugin("nonexistent_vendor_xyz")
        assert plugin is None
