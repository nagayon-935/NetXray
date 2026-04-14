from typing import Any, List, Dict

from translator.ir_helpers import get_ir_nodes, get_ir_links, get_node_interfaces

# RFC 9234 valid complementary BGP role pairs
_VALID_ROLE_PAIRS = {
    ("provider", "customer"),
    ("customer", "provider"),
    ("peer", "peer"),
    ("rs", "rs-client"),
    ("rs-client", "rs"),
}


class DiagnosisIssue:
    def __init__(self, category: str, severity: str, message: str, node_ids: List[str] = None):
        self.category = category  # "BGP", "ACL", "Security", "VRF"
        self.severity = severity  # "critical", "warning", "info"
        self.message = message
        self.node_ids = node_ids or []

    def to_dict(self):
        return {
            "category": self.category,
            "severity": self.severity,
            "message": self.message,
            "node_ids": self.node_ids,
        }


def check_bgp_role_mismatches(ir: Dict[str, Any]) -> List[DiagnosisIssue]:
    """
    Port of frontend detectBgpRoleMismatches.
    Checks that each BGP session pair has complementary RFC 9234 roles.
    Valid pairs: provider↔customer, peer↔peer, rs↔rs-client.
    """
    issues: List[DiagnosisIssue] = []
    nodes = get_ir_nodes(ir)
    node_map: Dict[str, Any] = {n["id"]: n for n in nodes}

    # Track already-reported pairs to avoid duplicate warnings in both directions
    reported_pairs: set[frozenset] = set()

    for node in nodes:
        bgp = node.get("bgp")
        if not bgp:
            continue

        for session in bgp.get("sessions", []):
            local_role = session.get("role")
            peer_node_id = session.get("peer_node")

            # Skip sessions without an explicit role (null, empty, or the "undefined" sentinel)
            if local_role in (None, "", "undefined"):
                continue
            if not peer_node_id:
                continue

            peer_node = node_map.get(peer_node_id)
            if not peer_node:
                continue

            # Find the reverse session on the peer node
            peer_bgp = peer_node.get("bgp", {})
            peer_session = next(
                (s for s in peer_bgp.get("sessions", []) if s.get("peer_node") == node["id"]),
                None,
            )
            if not peer_session:
                continue

            remote_role = peer_session.get("role")
            if remote_role in (None, "", "undefined"):
                continue

            # Deduplicate: skip if we already reported this pair
            pair_key = frozenset({node["id"], peer_node_id})
            if pair_key in reported_pairs:
                continue
            reported_pairs.add(pair_key)

            if (local_role, remote_role) not in _VALID_ROLE_PAIRS:
                issues.append(
                    DiagnosisIssue(
                        "BGP",
                        "warning",
                        (
                            f"BGP role mismatch between '{node['id']}' (role: {local_role}) "
                            f"and '{peer_node_id}' (role: {remote_role}). "
                            "Expected complementary roles per RFC 9234 "
                            "(provider↔customer, peer↔peer, rs↔rs-client)."
                        ),
                        [node["id"], peer_node_id],
                    )
                )

    return issues


def check_acl_best_practices(ir: Dict[str, Any]) -> List[DiagnosisIssue]:
    """
    Detect ACL rules that shadow all subsequent rules.
    Looks in ir.policies.acls (global ACL definitions).
    """
    issues: List[DiagnosisIssue] = []
    acls: Dict[str, list] = ir.get("policies", {}).get("acls", {})

    for acl_name, rules in acls.items():
        if not rules:
            continue

        # Check for 'permit any any' not at the end — it shadows every rule after it
        for i, rule in enumerate(rules[:-1]):
            if (
                rule.get("src") == "any"
                and rule.get("dst") == "any"
                and rule.get("action") == "permit"
            ):
                # Find which nodes reference this ACL
                affected_nodes = _nodes_using_acl(ir, acl_name)
                issues.append(
                    DiagnosisIssue(
                        "ACL",
                        "warning",
                        (
                            f"ACL '{acl_name}' has 'permit any any' at sequence {rule.get('seq', i+1)} "
                            "before the end of the list — all subsequent rules will never match."
                        ),
                        affected_nodes,
                    )
                )

    return issues


def _nodes_using_acl(ir: Dict[str, Any], acl_name: str) -> List[str]:
    """Return IDs of nodes that reference acl_name on any interface."""
    node_ids: List[str] = []
    for node in get_ir_nodes(ir):
        ifaces = get_node_interfaces(node)
        for iface in ifaces.values():
            if iface.get("acl_in") == acl_name or iface.get("acl_out") == acl_name:
                node_ids.append(node["id"])
                break
    return node_ids


def check_security_best_practices(ir: Dict[str, Any]) -> List[DiagnosisIssue]:
    """
    Warn about IP-addressed interfaces with no inbound ACL applied.
    Interfaces are stored as a dict keyed by interface name in the IR.
    """
    issues: List[DiagnosisIssue] = []
    for node in get_ir_nodes(ir):
        ifaces = get_node_interfaces(node)
        for iface_name, iface in ifaces.items():
            if iface.get("ip") and not iface.get("acl_in"):
                issues.append(
                    DiagnosisIssue(
                        "Security",
                        "info",
                        (
                            f"Interface '{iface_name}' on node '{node['id']}' "
                            "has an IP address but no inbound ACL applied."
                        ),
                        [node["id"]],
                    )
                )
    return issues


RULE_CHECKS = [
    check_bgp_role_mismatches,
    check_acl_best_practices,
    check_security_best_practices,
]
