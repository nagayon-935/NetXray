import importlib
import pkgutil
from typing import Dict, Type
from .plugin_base import VendorPlugin

_plugins: Dict[str, VendorPlugin] = {}

def discover_plugins():
    global _plugins
    if _plugins:
        return _plugins

    # Look for subdirectories in the plugins directory
    package = importlib.import_module(__name__)
    for loader, module_name, is_pkg in pkgutil.iter_modules(package.__path__):
        if is_pkg:
            try:
                # Try to import 'plugin' module from the sub-package
                module = importlib.import_module(f".{module_name}.plugin", __package__)
                if hasattr(module, "plugin"):
                    plugin = getattr(module, "plugin")
                    if isinstance(plugin, VendorPlugin):
                        _plugins[plugin.vendor_name] = plugin
            except (ImportError, AttributeError) as e:
                # Log or handle error if plugin cannot be loaded
                print(f"Failed to load plugin {module_name}: {e}")
                continue
    
    return _plugins

def get_plugin(vendor_name: str) -> VendorPlugin | None:
    plugins = discover_plugins()
    return plugins.get(vendor_name)
