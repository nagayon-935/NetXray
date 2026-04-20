from typing import Any, Protocol, TypedDict


class InterfaceData(TypedDict, total=False):
    name: str
    ip: str | None        # CIDR notation e.g. "10.0.0.1/30"
    state: str            # "up" | "down"
    cost: int | None
    acl_in: str | None
    acl_out: str | None


class RouteData(TypedDict):
    prefix: str
    next_hop: str | None
    protocol: str         # "bgp" | "ospf" | "connected" | "static"
    metric: int | None
    via_interface: str | None


class AclRuleData(TypedDict, total=False):
    seq: int
    action: str           # "permit" | "deny"
    protocol: str         # "tcp" | "udp" | "icmp" | "any"
    src: str
    dst: str
    src_port: int | None
    dst_port: int | None


class VendorParser(Protocol):
    vendor_name: str

    def parse_interfaces(self, raw_outputs: dict[str, str]) -> list[InterfaceData]: ...
    def parse_routes(self, raw_outputs: dict[str, str]) -> dict[str, list[RouteData]]: ...
    def parse_acls(self, raw_outputs: dict[str, str]) -> dict[str, list[AclRuleData]]: ...
    # Optional — parsers may implement these to populate node.bgp / node.ospf.
    # ir_builder uses hasattr() to detect availability, so missing methods are fine.
    def parse_bgp(self, raw_outputs: dict[str, str]) -> dict[str, Any] | None: ...
    def parse_ospf(self, raw_outputs: dict[str, str]) -> dict[str, Any] | None: ...
