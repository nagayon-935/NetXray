import logging
from fastapi import APIRouter, Response
from prometheus_client import Gauge, generate_latest, CONTENT_TYPE_LATEST
from api.state import get_current_ir
from diagnosis.rules import check_acl_best_practices

router = APIRouter(tags=["metrics"])

# Define Prometheus Gauges
bgp_sessions = Gauge('netxray_bgp_sessions_total', 'Total number of BGP sessions by state', ['state'])
links_down = Gauge('netxray_links_down_total', 'Total number of links in down state')
acl_shadow_count = Gauge('netxray_acl_shadow_count', 'Number of shadowed rules per ACL', ['acl'])
reachability_failures = Gauge('netxray_reachability_failures_total', 'Total reachability failures detected')

BGP_STATES = ("established", "idle", "connect", "active", "opensent", "openconfirm", "unknown")

@router.get("/metrics")
async def metrics():
    """
    Expose Prometheus metrics by deriving them from the current IR state.
    """
    # Get the latest IR from global in-memory state (set when a topology is loaded/saved)
    ir = get_current_ir()
    
    # Example derivation (mocked if ir is None)
    if ir:
        # 1. BGP Sessions
        states = {state: 0 for state in BGP_STATES}
        for node in ir.get("topology", {}).get("nodes", []):
            for session in node.get("bgp", {}).get("sessions", []):
                state = session.get("state", "unknown")
                if state in states:
                    states[state] += 1
        for state, count in states.items():
            bgp_sessions.labels(state=state).set(count)
            
        # 2. Links Down
        down_count = sum(1 for l in ir.get("topology", {}).get("links", []) if l.get("state") == "down")
        links_down.set(down_count)

        # 3. ACL shadowed-rule count (derived from diagnosis rules)
        acl_issues = check_acl_best_practices(ir)
        # Count shadowing issues per ACL name (extract from message)
        acl_shadow_counts: dict[str, int] = {}
        for issue in acl_issues:
            # Message format: "ACL '<name>' has ..."
            try:
                acl_name = issue.message.split("'")[1]
            except IndexError:
                acl_name = "unknown"
            acl_shadow_counts[acl_name] = acl_shadow_counts.get(acl_name, 0) + 1
        for acl_name, count in acl_shadow_counts.items():
            acl_shadow_count.labels(acl=acl_name).set(count)

        # 4. Reachability failures (rule-based check placeholder)
        reachability_failures.set(0)
    else:
        # Sample data when no IR is loaded
        bgp_sessions.labels(state="established").set(4)
        bgp_sessions.labels(state="idle").set(1)
        links_down.set(2)
        reachability_failures.set(0)

    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
