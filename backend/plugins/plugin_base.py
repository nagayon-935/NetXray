from dataclasses import dataclass
from typing import Protocol, Any
from translator.parser_base import InterfaceData, RouteData, AclRuleData

class VendorConfigGenerator(Protocol):
    vendor_name: str
    def generate_interface_config(self, name: str, current: InterfaceData | None, desired: InterfaceData) -> list[str]: ...
    def generate_acl_config(self, acl_name: str, rules: list[AclRuleData]) -> list[str]: ...
    def generate_bgp_config(self, bgp: dict[str, Any]) -> list[str]: ...
    def generate_full_diff(self, base_node: dict[str, Any], target_node: dict[str, Any]) -> list[str]: ...
    def generate_startup_config(self, node: dict[str, Any]) -> str: ...

class VendorDriver(Protocol):
    @classmethod
    def vendor_name(cls) -> str: ...
    def collect(self, host: str, credentials: dict[str, str], node_name: str | None = None) -> dict[str, str]: ...

class VendorParser(Protocol):
    vendor_name: str
    def parse_interfaces(self, raw_outputs: dict[str, str]) -> list[InterfaceData]: ...
    def parse_routes(self, raw_outputs: dict[str, str]) -> dict[str, list[RouteData]]: ...
    def parse_acls(self, raw_outputs: dict[str, str]) -> dict[str, list[AclRuleData]]: ...

@dataclass(frozen=True)
class VendorPlugin:
    """Immutable bundle of one vendor's driver, parser, and config generator.

    Vendor packages under ``plugins/`` expose an instance named ``plugin``
    in their ``plugin.py``; ``plugins.discover_plugins()`` picks it up.
    """
    vendor_name: str
    driver_class: type[VendorDriver]
    parser_class: type[VendorParser]
    config_generator_class: type[VendorConfigGenerator]
