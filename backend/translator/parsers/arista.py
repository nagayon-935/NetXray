"""Arista EOS output parser (eAPI JSON format).

Commands consumed:
  - show interfaces            -> interfaces
  - show ip route              -> default VRF routes
  - show ip route vrf all      -> all VRF routes
  - show ip access-lists       -> ACL rules
"""

import json
import logging

from translator.parser_base import AclRuleData, InterfaceData, RouteData

logger = logging.getLogger(__name__)

_PROTO_MAP = {
    "eBGP": "bgp",
    "iBGP": "bgp",
    "OSPF Intra": "ospf",
    "OSPF Inter": "ospf",
    "ospf": "ospf",
    "connected": "connected",
    "static": "static",
}


class AristaParser:
    vendor_name = "arista"

    def parse_interfaces(self, raw_outputs: dict[str, str]) -> list[InterfaceData]:
        raw = raw_outputs.get("show interfaces") or raw_outputs.get("show_interfaces")
        if not raw:
            return []
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Arista: failed to parse 'show interfaces'")
            return []

        interfaces: list[InterfaceData] = []
        for name, iface in data.get("interfaces", {}).items():
            ip = self._extract_ip(iface)
            state = "up" if iface.get("lineProtocolStatus", "") == "up" else "down"
            interfaces.append(InterfaceData(name=name, ip=ip, state=state))
        return interfaces

    def _extract_ip(self, iface: dict) -> str | None:
        for addr in iface.get("interfaceAddress", []):
            primary = addr.get("primaryIp", {})
            address = primary.get("address")
            mask_len = primary.get("maskLen")
            if address and address != "0.0.0.0" and mask_len is not None:
                return f"{address}/{mask_len}"
        return None

    def parse_routes(self, raw_outputs: dict[str, str]) -> dict[str, list[RouteData]]:
        vrfs: dict[str, list[RouteData]] = {}

        vrf_all_raw = raw_outputs.get("show ip route vrf all") or raw_outputs.get("show_ip_route_vrf_all")
        if vrf_all_raw:
            try:
                data = json.loads(vrf_all_raw)
                for vrf_name, vrf_data in data.get("vrfs", {}).items():
                    vrfs[vrf_name] = self._parse_vrf_routes(vrf_data)
                return vrfs
            except json.JSONDecodeError:
                logger.warning("Arista: failed to parse 'show ip route vrf all'")

        raw = raw_outputs.get("show ip route") or raw_outputs.get("show_ip_route")
        if raw:
            try:
                data = json.loads(raw)
                for vrf_name, vrf_data in data.get("vrfs", {}).items():
                    vrfs[vrf_name] = self._parse_vrf_routes(vrf_data)
            except json.JSONDecodeError:
                logger.warning("Arista: failed to parse 'show ip route'")

        return vrfs

    def _parse_vrf_routes(self, vrf_data: dict) -> list[RouteData]:
        routes: list[RouteData] = []
        for prefix, route_entry in vrf_data.get("routes", {}).items():
            route_type = route_entry.get("routeType", "")
            proto = _PROTO_MAP.get(route_type)
            if proto is None:
                continue
            for via in route_entry.get("vias", [{}]):
                routes.append(RouteData(
                    prefix=prefix,
                    next_hop=via.get("nexthopAddr") or via.get("gateway"),
                    protocol=proto,
                    metric=route_entry.get("metric"),
                    via_interface=via.get("interface"),
                ))
        return routes

    def parse_acls(self, raw_outputs: dict[str, str]) -> dict[str, list[AclRuleData]]:
        raw = raw_outputs.get("show ip access-lists") or raw_outputs.get("show_ip_access_lists")
        if not raw:
            return {}
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            logger.warning("Arista: failed to parse 'show ip access-lists'")
            return {}

        acls: dict[str, list[AclRuleData]] = {}
        for acl in data.get("aclList", []):
            name = acl.get("name", "")
            rules: list[AclRuleData] = []
            for entry in acl.get("sequence", []):
                action_text = entry.get("actionText", "")
                # actionText format: "permit tcp ..."
                parts = action_text.split()
                if len(parts) < 2:
                    continue
                action = parts[0] if parts[0] in ("permit", "deny") else None
                if action is None:
                    continue
                proto = parts[1] if len(parts) > 1 else "any"
                src = entry.get("sourceText", "any").strip() or "any"
                dst = entry.get("destinationText", "any").strip() or "any"
                dst_port_str = entry.get("destinationPortText", "")
                dst_port = None
                if dst_port_str:
                    nums = [p for p in dst_port_str.split() if p.isdigit()]
                    if nums:
                        dst_port = int(nums[0])

                rules.append(AclRuleData(
                    seq=entry.get("sequenceNumber", 0),
                    action=action,
                    protocol=proto if proto in ("tcp", "udp", "icmp", "any") else "any",
                    src=src,
                    dst=dst,
                    src_port=None,
                    dst_port=dst_port,
                ))
            if rules:
                acls[name] = rules

        return acls
