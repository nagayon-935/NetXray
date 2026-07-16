"""Dynamic vendor-plugin discovery.

Every sub-package of ``plugins`` that ships a ``plugin.py`` exposing a
``plugin: VendorPlugin`` instance is picked up automatically — consumers
(collector, translator, api) never hardcode vendor names.
"""
import importlib
import logging
import pkgutil

from .plugin_base import VendorPlugin

logger = logging.getLogger(__name__)

_plugins: dict[str, VendorPlugin] | None = None


def discover_plugins(refresh: bool = False) -> dict[str, VendorPlugin]:
    """Return all discovered vendor plugins keyed by vendor name.

    The result is cached after the first scan; pass ``refresh=True`` to
    rescan. A defensive copy is returned so callers cannot mutate the cache.
    """
    global _plugins
    if _plugins is None or refresh:
        _plugins = _scan_packages()
    return dict(_plugins)


def get_plugin(vendor_name: str) -> VendorPlugin | None:
    return discover_plugins().get(vendor_name)


def driver_registry() -> dict[str, type]:
    """Vendor name → driver class, derived from the discovered plugins."""
    return {name: p.driver_class for name, p in discover_plugins().items()}


def parser_registry() -> dict[str, type]:
    """Vendor name → parser class, derived from the discovered plugins."""
    return {name: p.parser_class for name, p in discover_plugins().items()}


def _scan_packages() -> dict[str, VendorPlugin]:
    package = importlib.import_module(__name__)
    found: dict[str, VendorPlugin] = {}
    for _, module_name, is_pkg in pkgutil.iter_modules(package.__path__):
        if not is_pkg:
            continue
        try:
            module = importlib.import_module(f".{module_name}.plugin", __package__)
        except ImportError as exc:
            logger.warning("Skipping plugin package %s: %s", module_name, exc)
            continue
        plugin = getattr(module, "plugin", None)
        if not isinstance(plugin, VendorPlugin):
            logger.warning(
                "Skipping plugin package %s: no VendorPlugin instance named 'plugin'",
                module_name,
            )
            continue
        found[plugin.vendor_name] = plugin
    return found
