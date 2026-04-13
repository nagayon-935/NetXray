from plugins.frr.driver import FrrDriver
from plugins.arista.driver import AristaDriver

DRIVER_REGISTRY: dict[str, type] = {
    "frr": FrrDriver,
    "arista": AristaDriver,
}

__all__ = ["FrrDriver", "AristaDriver", "DRIVER_REGISTRY"]
