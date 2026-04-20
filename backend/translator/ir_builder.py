"""Assemble NetXray-IR JSON from collected node data."""

import logging
from typing import Any

from translator.link_builder import build_links
from translator.parser_base import InterfaceData

logger = logging.getLogger(__name__)


def build_ir(
    nodes: list,  # list[ClabNode]
    driver_outputs: dict[str, dict[str, str]],
    parser_registry: dict[str, type],
) -> dict[str, Any]:
    """
    Build a NetXray-IR dict from collected outputs.

    nodes            : ClabNode list from clab.inspect_lab()
    driver_outputs   : {node_name: {command -> output}}
    parser_registry  : {vendor -> VendorParser class}
    """
    ir_nodes: list[dict] = []
    node_interfaces: dict[str, list[InterfaceData]] = {}
    all_acls: dict[str, list] = {}

    for node in nodes:
        vendor = node.vendor
        outputs = driver_outputs.get(node.name, {})
        parser_cls = parser_registry.get(vendor)

        if parser_cls is None:
            logger.warning("No parser for vendor '%s', skipping node %s", vendor, node.name)
            ifaces_raw: list[InterfaceData] = []
            vrfs: dict[str, list] = {}
            acls: dict[str, list] = {}
        else:
            parser = parser_cls()
            ifaces_raw = parser.parse_interfaces(outputs)
            vrfs = parser.parse_routes(outputs)
            acls = parser.parse_acls(outputs)

        # Merge ACLs
        all_acls.update(acls)
        node_interfaces[node.name] = ifaces_raw

        # Build IR interface map
        ifaces_ir: dict[str, dict] = {}
        for iface in ifaces_raw:
            entry: dict[str, Any] = {
                "ip": iface.get("ip"),
                "state": iface.get("state", "up"),
                "acl_in": iface.get("acl_in"),
                "acl_out": iface.get("acl_out"),
            }
            # cost is an integer field in schema — omit if None
            cost = iface.get("cost")
            if cost is not None:
                entry["cost"] = cost
            ifaces_ir[iface["name"]] = entry

        # Build IR VRF map
        vrfs_ir: dict[str, dict] = {}
        for vrf_name, routes in vrfs.items():
            vrfs_ir[vrf_name] = {
                "routing_table": [
                    {
                        "prefix": r["prefix"],
                        "next_hop": r.get("next_hop"),
                        "protocol": r["protocol"],
                        "metric": r.get("metric"),
                        "via_interface": r.get("via_interface"),
                    }
                    for r in routes
                ]
            }
        if not vrfs_ir:
            vrfs_ir["default"] = {"routing_table": []}

        ir_nodes.append({
            "id": node.name,
            "type": _infer_node_type(vendor),
            "vendor": vendor,
            "hostname": node.name,
            "interfaces": ifaces_ir,
            "vrfs": vrfs_ir,
        })

    # Build links
    links = build_links(node_interfaces)
    ir_links = [
        {
            "id": link.id,
            "source": {"node": link.source.node, "interface": link.source.interface},
            "target": {"node": link.target.node, "interface": link.target.interface},
            "state": link.state,
        }
        for link in links
    ]

    return {
        "ir_version": "0.1.0",
        "topology": {
            "nodes": ir_nodes,
            "links": ir_links,
        },
        "policies": {
            "acls": all_acls,
        },
    }


def _infer_node_type(vendor: str) -> str:
    if vendor in ("frr", "arista", "cisco_xr", "juniper_junos"):
        return "router"
    # Map generic/linux nodes to 'host' to match IR schema enum: [router, switch, host]
    return "host"
