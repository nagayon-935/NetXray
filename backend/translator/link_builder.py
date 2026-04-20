"""Infer links between nodes from shared subnets (/30, /31, /32).

Algorithm:
  1. Collect all (node_name, iface_name, ip_address, network) tuples
  2. Group by network — pairs sharing a /30 or /31 network are P2P links
  3. Emit Link objects for each pair
"""

import ipaddress
from dataclasses import dataclass

from translator.parser_base import InterfaceData


@dataclass
class LinkEndpoint:
    node: str
    interface: str


@dataclass
class Link:
    id: str
    source: LinkEndpoint
    target: LinkEndpoint
    state: str = "up"


def build_links(node_interfaces: dict[str, list[InterfaceData]]) -> list[Link]:
    """
    node_interfaces: {node_name: [InterfaceData, ...]}
    Returns a list of Link objects inferred from shared subnets.
    """
    # Build: network -> list of (node, iface, ip)
    net_to_endpoints: dict[str, list[tuple[str, str, str]]] = {}

    for node_name, ifaces in node_interfaces.items():
        for iface in ifaces:
            ip_cidr = iface.get("ip")
            if not ip_cidr:
                continue
            try:
                interface_net = ipaddress.IPv4Interface(ip_cidr)
            except ValueError:
                continue
            prefix_len = interface_net.network.prefixlen
            # Only /30, /31, /32 are unambiguously P2P subnets
            if prefix_len < 30:
                continue
            net_key = str(interface_net.network)
            net_to_endpoints.setdefault(net_key, []).append(
                (node_name, iface["name"], str(interface_net.ip))
            )

    links: list[Link] = []
    seen: set[frozenset[tuple[str, str]]] = set()

    for net_key, endpoints in net_to_endpoints.items():
        if len(endpoints) != 2:
            continue  # skip non-P2P subnets
        (n1, i1, _), (n2, i2, _) = endpoints
        pair = frozenset(((n1, i1), (n2, i2)))
        if pair in seen:
            continue
        seen.add(pair)
        link_id = f"link-{n1}-{i1}-{n2}-{i2}"
        links.append(Link(
            id=link_id,
            source=LinkEndpoint(node=n1, interface=i1),
            target=LinkEndpoint(node=n2, interface=i2),
        ))

    return links
