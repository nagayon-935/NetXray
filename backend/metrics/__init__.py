"""
Metrics derivation module — converts an in-memory NetXray IR dict into
structured data that the Prometheus route can turn into Gauge values.

All derivation logic lives here so it can be unit-tested independently
of the HTTP layer.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class BgpMetrics:
    sessions_by_state: dict[str, int] = field(default_factory=dict)


@dataclass
class NodeMetrics:
    count_by_type: dict[str, int] = field(default_factory=dict)


@dataclass
class InterfaceMetrics:
    up_count: int = 0
    down_count: int = 0
    # (node_id, iface_name) -> (in_bps, out_bps)
    traffic: dict[tuple[str, str], tuple[int, int]] = field(default_factory=dict)


@dataclass
class LinkMetrics:
    down_count: int = 0


@dataclass
class DerivedMetrics:
    bgp: BgpMetrics = field(default_factory=BgpMetrics)
    nodes: NodeMetrics = field(default_factory=NodeMetrics)
    interfaces: InterfaceMetrics = field(default_factory=InterfaceMetrics)
    links: LinkMetrics = field(default_factory=LinkMetrics)


_BGP_STATES = (
    "established", "idle", "connect", "active",
    "opensent", "openconfirm", "unknown",
)


def derive_metrics(ir: dict[str, Any]) -> DerivedMetrics:
    """
    Walk the IR dict and produce structured :class:`DerivedMetrics`.

    Safe to call with any (possibly partial) IR — missing fields are
    treated as empty collections.
    """
    result = DerivedMetrics()

    topo = ir.get("topology") or {}
    nodes: list[dict] = topo.get("nodes") or []
    links: list[dict] = topo.get("links") or []

    # Node counts by type
    for node in nodes:
        node_type = node.get("type", "unknown")
        result.nodes.count_by_type[node_type] = (
            result.nodes.count_by_type.get(node_type, 0) + 1
        )

    # BGP session states
    result.bgp.sessions_by_state = {s: 0 for s in _BGP_STATES}
    for node in nodes:
        bgp = node.get("bgp") or {}
        for session in bgp.get("sessions") or []:
            state = session.get("state", "unknown")
            key = state if state in result.bgp.sessions_by_state else "unknown"
            result.bgp.sessions_by_state[key] += 1

    # Interface state + traffic counters
    for node in nodes:
        node_id = node.get("id", "")
        ifaces = node.get("interfaces") or {}
        for iface_name, iface in ifaces.items():
            if iface.get("state") == "up":
                result.interfaces.up_count += 1
            else:
                result.interfaces.down_count += 1

            in_bps = int(iface.get("traffic_in_bps") or 0)
            out_bps = int(iface.get("traffic_out_bps") or 0)
            if in_bps or out_bps:
                result.interfaces.traffic[(node_id, iface_name)] = (in_bps, out_bps)

    # Link down count
    result.links.down_count = sum(
        1 for link in links if link.get("state") == "down"
    )

    return result
