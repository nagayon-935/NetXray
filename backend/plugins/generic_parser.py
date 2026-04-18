import json
import logging
from translator.parser_base import ParserBase, InterfaceData

logger = logging.getLogger(__name__)

class GenericParser(ParserBase):
    def parse_interfaces(self, outputs: dict[str, str]) -> list[InterfaceData]:
        raw = outputs.get("ip -j addr", "[]")
        try:
            data = json.loads(raw)
        except:
            return []
            
        ifaces = []
        for item in data:
            name = item.get("ifname", "")
            if name == "lo": continue
            
            state = "up" if item.get("operstate") == "UP" else "down"
            ip = None
            addr_info = item.get("addr_info", [])
            if addr_info:
                # Find first IPv4
                v4 = [a for a in addr_info if a.get("family") == "inet"]
                if v4:
                    ip = f"{v4[0].get('local')}/{v4[0].get('prefixlen')}"
            
            ifaces.append(InterfaceData(
                name=name,
                state=state,
                ip=ip,
                mac=item.get("address"),
                mtu=item.get("mtu")
            ))
        return ifaces

    def parse_routes(self, outputs: dict[str, str]) -> dict[str, list]:
        raw = outputs.get("ip -j route", "[]")
        try:
            data = json.loads(raw)
        except:
            return {"default": {"routing_table": []}}
            
        routes = []
        for r in data:
            dst = r.get("dst")
            if dst == "default": dst = "0.0.0.0/0"
            
            routes.append({
                "prefix": dst,
                "next_hop": r.get("gateway"),
                "protocol": "static" if r.get("gateway") else "connected",
                "via_interface": r.get("dev")
            })
        return {"default": {"routing_table": routes}}

    def parse_acls(self, outputs: dict[str, str]) -> dict[str, list]:
        return {}
