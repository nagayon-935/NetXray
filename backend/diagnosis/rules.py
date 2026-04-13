from typing import Any, List, Dict

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
            "node_ids": self.node_ids
        }

def check_bgp_role_mismatches(ir: Dict[str, Any]) -> List[DiagnosisIssue]:
    issues = []
    # Simplified logic from frontend detectBgpRoleMismatches
    # In a real app, we'd use more sophisticated logic
    return issues

def check_acl_best_practices(ir: Dict[str, Any]) -> List[DiagnosisIssue]:
    issues = []
    for node in ir.get("topology", {}).get("nodes", []):
        for acl_name, rules in node.get("acls", {}).items():
            if not rules:
                continue
            
            # Check for permit any any not at the end
            for i, rule in enumerate(rules[:-1]):
                if rule.get("src") == "any" and rule.get("dst") == "any" and rule.get("action") == "permit":
                    issues.append(DiagnosisIssue(
                        "ACL", "warning",
                        f"ACL '{acl_name}' on node '{node['id']}' has 'permit any any' before the end of the list. Subsequence rules will be ignored.",
                        [node["id"]]
                    ))
    return issues

def check_security_best_practices(ir: Dict[str, Any]) -> List[DiagnosisIssue]:
    issues = []
    for node in ir.get("topology", {}).get("nodes", []):
        for iface in node.get("interfaces", {}).values() if isinstance(node.get("interfaces"), dict) else node.get("interfaces", []):
            if iface.get("ip") and not iface.get("acl_in"):
                issues.append(DiagnosisIssue(
                    "Security", "info",
                    f"Interface '{iface.get('name', 'unknown')}' on node '{node['id']}' has an IP address but no inbound ACL applied.",
                    [node["id"]]
                ))
    return issues

RULE_CHECKS = [
    check_bgp_role_mismatches,
    check_acl_best_practices,
    check_security_best_practices
]
