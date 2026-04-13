from collector.drivers.frr import FrrDriver
from collector.drivers.arista import AristaDriver

DRIVER_REGISTRY: dict[str, type] = {
    "frr": FrrDriver,
    "arista": AristaDriver,
}

__all__ = ["FrrDriver", "AristaDriver", "DRIVER_REGISTRY"]
