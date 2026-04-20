"""FRR (Free Range Routing) output parser.

Commands consumed:
  - show interface json       -> interfaces
  - show ip route json        -> default VRF routes
  - show ip route vrf all json -> all VRF routes
  - show running-config       -> ACL / BGP / OSPF (regex)
"""

import json
import logging
import re
from typing import Any

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

    # ------------------------------------------------------------------
    # BGP  (from running-config text)
    # ------------------------------------------------------------------

    def parse_bgp(self, raw_outputs: dict[str, str]) -> dict[str, Any] | None:
        raw = raw_outputs.get("show running-config") or raw_outputs.get("show_running_config")
        if not raw:
            return None

        local_as: int | None = None
        router_id: str = ""
        sessions: list[dict[str, Any]] = []
        # peer_ip -> list[str] of address-families
        afi_map: dict[str, list[str]] = {}

        in_bgp = False
        current_afi: str | None = None

        for line in raw.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("!"):
                continue

            # Enter BGP block
            m = re.match(r"^router bgp\s+(\d+)", stripped)
            if m:
                in_bgp = True
                local_as = int(m.group(1))
                current_afi = None
                continue

            # Exit BGP block on a new top-level "router ..." / "interface ..." / unindented keyword
            if in_bgp and line and not line[0].isspace() and not stripped.startswith("router bgp"):
                in_bgp = False
                current_afi = None

            if not in_bgp:
                continue

            m = re.match(r"^bgp router-id\s+(\S+)", stripped)
            if m:
                router_id = m.group(1)
                continue

            m = re.match(r"^address-family\s+(\S+)(?:\s+(\S+))?", stripped)
            if m:
                family = m.group(1).lower()
                sub = (m.group(2) or "").lower()
                current_afi = f"{family}_{sub}" if sub else family
                continue

            if stripped.startswith("exit-address-family"):
                current_afi = None
                continue

            m = re.match(r"^neighbor\s+(\S+)\s+remote-as\s+(\d+)", stripped)
            if m:
                peer = m.group(1)
                remote_as = int(m.group(2))
                # Skip peer-group definitions: remote-as used with non-IP names
                if not _is_ip(peer):
                    continue
                sessions.append({
                    "peer_ip": peer,
                    "remote_as": remote_as,
                    "state": "unknown",
                })
                continue

            # Inside address-family: "neighbor <peer> activate"
            m = re.match(r"^neighbor\s+(\S+)\s+activate", stripped)
            if m and current_afi:
                peer = m.group(1)
                if _is_ip(peer):
                    afi_map.setdefault(peer, []).append(current_afi)

        if local_as is None:
            return None

        for session in sessions:
            afis = afi_map.get(session["peer_ip"])
            if afis:
                session["address_families"] = afis

        return {
            "local_as": local_as,
            "router_id": router_id,
            "sessions": sessions,
        }

    # ------------------------------------------------------------------
    # OSPF  (from running-config text)
    # ------------------------------------------------------------------

    def parse_ospf(self, raw_outputs: dict[str, str]) -> dict[str, Any] | None:
        raw = raw_outputs.get("show running-config") or raw_outputs.get("show_running_config")
        if not raw:
            return None

        router_id: str = ""
        process_id: int | None = None
        interfaces: list[dict[str, Any]] = []
        network_areas: list[tuple[str, str]] = []

        in_ospf = False
        current_iface: str | None = None
        iface_buf: dict[str, dict[str, Any]] = {}
        has_ospf_block = False

        for line in raw.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("!"):
                continue

            # router ospf [<id>]
            m = re.match(r"^router ospf(?:\s+(\d+))?$", stripped)
            if m:
                in_ospf = True
                has_ospf_block = True
                if m.group(1):
                    process_id = int(m.group(1))
                current_iface = None
                continue

            # Entering another top-level block
            if line and not line[0].isspace():
                in_ospf = False
                m_iface = re.match(r"^interface\s+(\S+)", stripped)
                current_iface = m_iface.group(1) if m_iface else None

            if in_ospf:
                m = re.match(r"^(?:ospf\s+)?router-id\s+(\S+)", stripped)
                if m:
                    router_id = m.group(1)
                    continue
                m = re.match(r"^network\s+(\S+)\s+area\s+(\S+)", stripped)
                if m:
                    network_areas.append((m.group(1), m.group(2)))
                    continue

            if current_iface is not None:
                m = re.match(r"^ip ospf area\s+(\S+)", stripped)
                if m:
                    iface_buf.setdefault(current_iface, {"name": current_iface})["area"] = m.group(1)
                    continue
                m = re.match(r"^ip ospf cost\s+(\d+)", stripped)
                if m:
                    iface_buf.setdefault(current_iface, {"name": current_iface})["cost"] = int(m.group(1))
                    continue
                m = re.match(r"^ip ospf network\s+(\S+)", stripped)
                if m:
                    iface_buf.setdefault(current_iface, {"name": current_iface})["network_type"] = m.group(1)
                    continue
                m = re.match(r"^ip ospf hello-interval\s+(\d+)", stripped)
                if m:
                    iface_buf.setdefault(current_iface, {"name": current_iface})["hello_interval"] = int(m.group(1))
                    continue
                m = re.match(r"^ip ospf dead-interval\s+(\d+)", stripped)
                if m:
                    iface_buf.setdefault(current_iface, {"name": current_iface})["dead_interval"] = int(m.group(1))
                    continue

        if not has_ospf_block and not iface_buf:
            return None

        # per-interface entries first, then any network-based entries that weren't already per-iface
        for iface in iface_buf.values():
            if "area" in iface:
                interfaces.append(iface)

        return {
            "router_id": router_id,
            "process_id": process_id,
            "interfaces": interfaces,
        }


def _is_ip(value: str) -> bool:
    return bool(re.match(r"^\d+\.\d+\.\d+\.\d+$", value) or ":" in value)
