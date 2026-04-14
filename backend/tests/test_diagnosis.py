"""Tests for backend diagnosis rules (Phase 7)."""
import pytest
from diagnosis.rules import (
    check_bgp_role_mismatches,
    check_acl_best_practices,
    check_security_best_practices,
)


# ─── Helpers ────────────────────────────────────────────────────────────────

def make_ir(nodes=None, links=None, policies=None):
    return {
        "ir_version": "0.2.0",
        "topology": {
            "nodes": nodes or [],
            "links": links or [],
        },
        "policies": policies or {},
    }


def make_node(node_id, interfaces=None, bgp=None):
    node = {"id": node_id, "type": "router"}
    if interfaces is not None:
        node["interfaces"] = interfaces
    if bgp is not None:
        node["bgp"] = bgp
    return node


# ─── BGP Role Mismatch ───────────────────────────────────────────────────────

class TestBgpRoleMismatches:
    def test_no_issues_when_no_bgp(self):
        ir = make_ir(nodes=[make_node("r1"), make_node("r2")])
        assert check_bgp_role_mismatches(ir) == []

    def test_valid_provider_customer_pair(self):
        r1 = make_node("r1", bgp={
            "local_as": 65000, "router_id": "1.1.1.1",
            "sessions": [{"peer_ip": "10.0.0.2", "peer_node": "r2", "remote_as": 65001, "state": "established", "role": "provider"}],
        })
        r2 = make_node("r2", bgp={
            "local_as": 65001, "router_id": "1.1.1.2",
            "sessions": [{"peer_ip": "10.0.0.1", "peer_node": "r1", "remote_as": 65000, "state": "established", "role": "customer"}],
        })
        ir = make_ir(nodes=[r1, r2])
        assert check_bgp_role_mismatches(ir) == []

    def test_valid_peer_peer(self):
        r1 = make_node("r1", bgp={
            "local_as": 65000, "router_id": "1.1.1.1",
            "sessions": [{"peer_ip": "10.0.0.2", "peer_node": "r2", "remote_as": 65001, "state": "established", "role": "peer"}],
        })
        r2 = make_node("r2", bgp={
            "local_as": 65001, "router_id": "1.1.1.2",
            "sessions": [{"peer_ip": "10.0.0.1", "peer_node": "r1", "remote_as": 65000, "state": "established", "role": "peer"}],
        })
        ir = make_ir(nodes=[r1, r2])
        assert check_bgp_role_mismatches(ir) == []

    def test_valid_rs_rsclient(self):
        r1 = make_node("r1", bgp={
            "local_as": 65000, "router_id": "1.1.1.1",
            "sessions": [{"peer_ip": "10.0.0.2", "peer_node": "r2", "remote_as": 65001, "state": "established", "role": "rs"}],
        })
        r2 = make_node("r2", bgp={
            "local_as": 65001, "router_id": "1.1.1.2",
            "sessions": [{"peer_ip": "10.0.0.1", "peer_node": "r1", "remote_as": 65000, "state": "established", "role": "rs-client"}],
        })
        ir = make_ir(nodes=[r1, r2])
        assert check_bgp_role_mismatches(ir) == []

    def test_mismatch_provider_provider(self):
        r1 = make_node("r1", bgp={
            "local_as": 65000, "router_id": "1.1.1.1",
            "sessions": [{"peer_ip": "10.0.0.2", "peer_node": "r2", "remote_as": 65001, "state": "established", "role": "provider"}],
        })
        r2 = make_node("r2", bgp={
            "local_as": 65001, "router_id": "1.1.1.2",
            "sessions": [{"peer_ip": "10.0.0.1", "peer_node": "r1", "remote_as": 65000, "state": "established", "role": "provider"}],
        })
        ir = make_ir(nodes=[r1, r2])
        issues = check_bgp_role_mismatches(ir)
        assert len(issues) == 1
        issue = issues[0]
        assert issue.category == "BGP"
        assert issue.severity == "warning"
        assert "r1" in issue.node_ids
        assert "r2" in issue.node_ids

    def test_mismatch_rs_peer(self):
        r1 = make_node("r1", bgp={
            "local_as": 65000, "router_id": "1.1.1.1",
            "sessions": [{"peer_ip": "10.0.0.2", "peer_node": "r2", "remote_as": 65001, "state": "established", "role": "rs"}],
        })
        r2 = make_node("r2", bgp={
            "local_as": 65001, "router_id": "1.1.1.2",
            "sessions": [{"peer_ip": "10.0.0.1", "peer_node": "r1", "remote_as": 65000, "state": "established", "role": "peer"}],
        })
        ir = make_ir(nodes=[r1, r2])
        issues = check_bgp_role_mismatches(ir)
        assert len(issues) == 1

    def test_no_duplicate_when_both_nodes_iterated(self):
        """Ensure we don't report the same pair twice."""
        r1 = make_node("r1", bgp={
            "local_as": 65000, "router_id": "1.1.1.1",
            "sessions": [{"peer_ip": "10.0.0.2", "peer_node": "r2", "remote_as": 65001, "state": "established", "role": "provider"}],
        })
        r2 = make_node("r2", bgp={
            "local_as": 65001, "router_id": "1.1.1.2",
            "sessions": [{"peer_ip": "10.0.0.1", "peer_node": "r1", "remote_as": 65000, "state": "established", "role": "provider"}],
        })
        ir = make_ir(nodes=[r1, r2])
        assert len(check_bgp_role_mismatches(ir)) == 1  # not 2

    def test_skips_null_role(self):
        """Sessions with null/undefined roles should not generate warnings."""
        r1 = make_node("r1", bgp={
            "local_as": 65000, "router_id": "1.1.1.1",
            "sessions": [{"peer_ip": "10.0.0.2", "peer_node": "r2", "remote_as": 65001, "state": "established", "role": None}],
        })
        r2 = make_node("r2", bgp={
            "local_as": 65001, "router_id": "1.1.1.2",
            "sessions": [{"peer_ip": "10.0.0.1", "peer_node": "r1", "remote_as": 65000, "state": "established", "role": None}],
        })
        ir = make_ir(nodes=[r1, r2])
        assert check_bgp_role_mismatches(ir) == []


# ─── ACL Best Practices ──────────────────────────────────────────────────────

class TestAclBestPractices:
    def test_no_issues_with_empty_acls(self):
        ir = make_ir()
        assert check_acl_best_practices(ir) == []

    def test_no_issues_when_permit_any_is_last(self):
        ir = make_ir(policies={
            "acls": {
                "ACL_MGMT": [
                    {"seq": 10, "action": "permit", "protocol": "tcp", "src": "10.0.0.0/8", "dst": "any"},
                    {"seq": 20, "action": "permit", "protocol": "any", "src": "any", "dst": "any"},
                ]
            }
        })
        assert check_acl_best_practices(ir) == []

    def test_detects_permit_any_in_middle(self):
        ir = make_ir(policies={
            "acls": {
                "ACL_WEB": [
                    {"seq": 10, "action": "permit", "protocol": "any", "src": "any", "dst": "any"},
                    {"seq": 20, "action": "deny",   "protocol": "tcp", "src": "any", "dst": "any"},
                ]
            }
        })
        issues = check_acl_best_practices(ir)
        assert len(issues) == 1
        assert issues[0].category == "ACL"
        assert issues[0].severity == "warning"
        assert "ACL_WEB" in issues[0].message

    def test_affected_nodes_listed(self):
        """Nodes that apply the ACL on an interface should appear in node_ids."""
        r1 = make_node("r1", interfaces={
            "eth0": {"ip": "10.0.0.1/24", "state": "up", "acl_in": "ACL_WEB", "acl_out": None},
        })
        ir = make_ir(
            nodes=[r1],
            policies={
                "acls": {
                    "ACL_WEB": [
                        {"seq": 10, "action": "permit", "protocol": "any", "src": "any", "dst": "any"},
                        {"seq": 20, "action": "deny",   "protocol": "tcp", "src": "any", "dst": "any"},
                    ]
                }
            }
        )
        issues = check_acl_best_practices(ir)
        assert len(issues) == 1
        assert "r1" in issues[0].node_ids


# ─── Security Best Practices ─────────────────────────────────────────────────

class TestSecurityBestPractices:
    def test_no_issues_with_no_interfaces(self):
        ir = make_ir(nodes=[make_node("r1")])
        assert check_security_best_practices(ir) == []

    def test_no_issue_when_acl_applied(self):
        r1 = make_node("r1", interfaces={
            "eth0": {"ip": "10.0.0.1/24", "state": "up", "acl_in": "ACL_MGT"},
        })
        ir = make_ir(nodes=[r1])
        assert check_security_best_practices(ir) == []

    def test_no_issue_for_interface_without_ip(self):
        r1 = make_node("r1", interfaces={
            "eth0": {"state": "up", "acl_in": None},
        })
        ir = make_ir(nodes=[r1])
        assert check_security_best_practices(ir) == []

    def test_issue_for_ip_interface_without_acl(self):
        r1 = make_node("r1", interfaces={
            "eth0": {"ip": "10.0.0.1/24", "state": "up", "acl_in": None},
        })
        ir = make_ir(nodes=[r1])
        issues = check_security_best_practices(ir)
        assert len(issues) == 1
        issue = issues[0]
        assert issue.category == "Security"
        assert issue.severity == "info"
        assert "r1" in issue.node_ids
        assert "eth0" in issue.message

    def test_multiple_interfaces_multiple_issues(self):
        r1 = make_node("r1", interfaces={
            "eth0": {"ip": "10.0.0.1/24", "state": "up", "acl_in": None},
            "eth1": {"ip": "10.0.1.1/24", "state": "up", "acl_in": None},
        })
        ir = make_ir(nodes=[r1])
        issues = check_security_best_practices(ir)
        assert len(issues) == 2
