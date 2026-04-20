"""FRR (Free Range Routing) output parser.

Commands consumed:
  - show interface json       -> interfaces
  - show ip route json        -> default VRF routes
  - show ip route vrf all json -> all VRF routes
  - show running-config       -> ACL rules (regex)
"""

import json
import logging
import re

from translator.parser_base import AclRuleData, InterfaceData, RouteData

logger = logging.getLogger(__name__)

# FRR protocol label -> IR protocol
_PROTO_MAP = {
    "connected": "connected",
    "static": "static",
    "bgp": "bgp",
    "ospf": "ospf",
    "ospfintra": "ospf",
    "ospfinter": "ospf",
    "kernel": None,   # ignore kernel routes
}

_ACL_BLOCK_RE = re.compile(r"^ip access-list\s+(\S+)", re.MULTILINE)
_ACL_RULE_RE = re.compile(
    r"^\s+(\d+)\s+(permit|deny)"
    r"\s+(tcp|udp|icmp|any)"
    r"\s+(\S+)"          # src
    r"\s+(\S+)"          # dst
    r"(?:\s+(?:eq|range)\s+(\d+))?",
    re.MULTILINE,
)


class FrrParser:
    vendor_name = "frr"

    # ------------------------------------------------------------------
    # Interfaces
    # ------------------------------------------------------------------

    def parse_interfaces(self, raw_outputs: dict[str, str]) -> list[InterfaceData]:
        raw = raw_outputs.get("show interface json") or raw_outputs.get("show_interface_json")
        if not raw:
            return []
        try:
            data = self._load_json(raw)
        except Exception as e:
            logger.warning(f"FRR: failed to parse 'show interface json': {e}")
            return []
        # ... rest of the logic ...

        interfaces: list[InterfaceData] = []
        for iface_name, iface in data.items():
            ip = self._extract_ip(iface)
            
            # Try multiple status fields used by different FRR versions
            state_raw = (
                iface.get("operationalStatus") or 
                iface.get("administrativeStatus") or 
                iface.get("operstate", "")
            )
            if not state_raw and isinstance(iface.get("linkUp"), bool):
                state_raw = "up" if iface["linkUp"] else "down"
            
            state = "up" if str(state_raw).lower() == "up" else "down"
            interfaces.append(InterfaceData(name=iface_name, ip=ip, state=state))
        return interfaces

    def _extract_ip(self, iface: dict) -> str | None:
        # Some versions use 'ipAddresses', others use 'addresses'
        addrs = iface.get("ipAddresses") or iface.get("addresses") or []
        for addr_entry in addrs:
            # If it's a simple dict with 'address' containing CIDR
            if isinstance(addr_entry, dict):
                addr_str = addr_entry.get("address") or addr_entry.get("ip")
                if addr_str and "/" in addr_str:
                    # Check if it's IPv4
                    if ":" not in addr_str:
                        return addr_str
                
                # Fallback to separate address/prefix fields
                address = addr_entry.get("address") or addr_entry.get("ip")
                prefix = addr_entry.get("prefixLength") or addr_entry.get("prefix")
                if address and prefix is not None:
                    if ":" not in str(address):
                        return f"{address}/{prefix}"
        return None

    def _load_json(self, text: str) -> dict:
        text = text.strip()
        if not text:
            return {}
        # If output contains non-JSON junk (like INFO logs), find the first '{' and last '}'
        if not text.startswith("{") and "{" in text:
            text = text[text.find("{"):]
        if not text.endswith("}") and "}" in text:
            text = text[:text.rfind("}") + 1]
        return json.loads(text)

    # ------------------------------------------------------------------
    # Routes  (returns VRF name -> list[RouteData])
    # ------------------------------------------------------------------

    def parse_routes(self, raw_outputs: dict[str, str]) -> dict[str, list[RouteData]]:
        vrfs: dict[str, list[RouteData]] = {}

        # all-VRF output takes priority
        vrf_all_raw = raw_outputs.get("show ip route vrf all json") or raw_outputs.get("show_ip_route_vrf_all_json")
        if vrf_all_raw:
            try:
                data = self._load_json(vrf_all_raw)
                for vrf_name, table in data.items():
                    vrfs[vrf_name] = self._parse_route_table(table)
                return vrfs
            except Exception as e:
                logger.warning(f"FRR: failed to parse 'show ip route vrf all json': {e}")

        # fallback to default-VRF only
        raw = raw_outputs.get("show ip route json") or raw_outputs.get("show_ip_route_json")
        if raw:
            try:
                data = self._load_json(raw)
                vrfs["default"] = self._parse_route_table(data)
            except Exception as e:
                logger.warning(f"FRR: failed to parse 'show ip route json': {e}")

        return vrfs

    def _parse_route_table(self, table: dict) -> list[RouteData]:
        routes: list[RouteData] = []
        for prefix, entries in table.items():
            if not isinstance(entries, list):
                continue
            for entry in entries:
                proto_raw = entry.get("protocol", "").lower()
                proto = _PROTO_MAP.get(proto_raw)
                if proto is None:
                    continue  # skip kernel / unknown
                for nexthop in entry.get("nexthops", [{}]):
                    routes.append(RouteData(
                        prefix=prefix,
                        next_hop=nexthop.get("ip") or nexthop.get("gateway"),
                        protocol=proto,
                        metric=entry.get("metric"),
                        via_interface=nexthop.get("interfaceName") or nexthop.get("interface"),
                    ))
        return routes

    # ------------------------------------------------------------------
    # ACLs  (from running-config text)
    # ------------------------------------------------------------------

    def parse_acls(self, raw_outputs: dict[str, str]) -> dict[str, list[AclRuleData]]:
        raw = raw_outputs.get("show running-config") or raw_outputs.get("show_running_config")
        if not raw:
            return {}

        acls: dict[str, list[AclRuleData]] = {}
        current: str | None = None

        for line in raw.splitlines():
            m_block = _ACL_BLOCK_RE.match(line)
            if m_block:
                current = m_block.group(1)
                acls.setdefault(current, [])
                continue

            if current is None:
                continue

            # blank line or unindented line ends the block
            if line and not line[0].isspace():
                current = None
                continue

            m_rule = _ACL_RULE_RE.match(line)
            if m_rule:
                seq, action, proto, src, dst, dst_port = m_rule.groups()
                acls[current].append(AclRuleData(
                    seq=int(seq),
                    action=action,
                    protocol=proto,
                    src=src,
                    dst=dst,
                    src_port=None,
                    dst_port=int(dst_port) if dst_port else None,
                ))

        return {k: v for k, v in acls.items() if v}
