from plugins.frr.driver import FrrDriver
from plugins.arista.driver import AristaDriver
from plugins.generic_driver import GenericDriver

DRIVER_REGISTRY: dict[str, type] = {
    "frr": FrrDriver,
    "arista": AristaDriver,
    "generic": GenericDriver,
}

__all__ = ["FrrDriver", "AristaDriver", "DRIVER_REGISTRY"]
