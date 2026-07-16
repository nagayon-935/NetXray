"""Driver dispatch table derived from the dynamic plugin registry.

``DRIVER_REGISTRY`` keeps its historical name and shape (vendor → driver
class) for existing consumers, but is now built from
``plugins.discover_plugins()`` instead of hardcoded imports.
"""
from plugins import driver_registry

DRIVER_REGISTRY: dict[str, type] = driver_registry()

__all__ = ["DRIVER_REGISTRY"]
