import logging
from fastapi import APIRouter, Response
from prometheus_client import Gauge, generate_latest, CONTENT_TYPE_LATEST
from api.state import get_current_ir
from diagnosis.rules import check_acl_best_practices
from metrics import derive_metrics

router = APIRouter(tags=["metrics"])

# Existing Prometheus Gauges
bgp_sessions = Gauge('netxray_bgp_sessions_total', 'Total number of BGP sessions by state', ['state'])
links_down = Gauge('netxray_links_down_total', 'Total number of links in down state')
acl_shadow_count = Gauge('netxray_acl_shadow_count', 'Number of shadowed rules per ACL', ['acl'])
reachability_failures = Gauge('netxray_reachability_failures_total', 'Total reachability failures detected')

# New Prometheus Gauges
nodes_total = Gauge('netxray_nodes_total', 'Total number of nodes by type', ['type'])
interfaces_up_total = Gauge('netxray_interfaces_up_total', 'Total number of interfaces in up state')
interfaces_down_total = Gauge('netxray_interfaces_down_total', 'Total number of interfaces in down state')
traffic_in_bps = Gauge('netxray_traffic_in_bps', 'Inbound traffic in bps per interface', ['node', 'interface'])
traffic_out_bps = Gauge('netxray_traffic_out_bps', 'Outbound traffic in bps per interface', ['node', 'interface'])

BGP_STATES = ("established", "idle", "connect", "active", "opensent", "openconfirm", "unknown")


@router.get("/metrics")
async def metrics():
    """
    Expose Prometheus metrics by deriving them from the current IR state.
    """
    ir = get_current_ir()

    if ir:
        m = derive_metrics(ir)

        # BGP sessions
        for state, count in m.bgp.sessions_by_state.items():
            bgp_sessions.labels(state=state).set(count)

        # Links down
        links_down.set(m.links.down_count)

        # Nodes by type
        for node_type, count in m.nodes.count_by_type.items():
            nodes_total.labels(type=node_type).set(count)

        # Interface up/down counts
        interfaces_up_total.set(m.interfaces.up_count)
        interfaces_down_total.set(m.interfaces.down_count)

        # Traffic per interface
        for (node_id, iface_name), (in_bps, out_bps) in m.interfaces.traffic.items():
            traffic_in_bps.labels(node=node_id, interface=iface_name).set(in_bps)
            traffic_out_bps.labels(node=node_id, interface=iface_name).set(out_bps)

        # ACL shadowed-rule count (derived from diagnosis rules)
        acl_issues = check_acl_best_practices(ir)
        acl_shadow_counts: dict[str, int] = {}
        for issue in acl_issues:
            try:
                acl_name = issue.message.split("'")[1]
            except IndexError:
                acl_name = "unknown"
            acl_shadow_counts[acl_name] = acl_shadow_counts.get(acl_name, 0) + 1
        for acl_name, count in acl_shadow_counts.items():
            acl_shadow_count.labels(acl=acl_name).set(count)

        # Reachability failures (placeholder)
        reachability_failures.set(0)
    else:
        # Sample data when no IR is loaded
        bgp_sessions.labels(state="established").set(4)
        bgp_sessions.labels(state="idle").set(1)
        links_down.set(2)
        reachability_failures.set(0)

    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)
