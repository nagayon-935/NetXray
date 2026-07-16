"""Parser dispatch table derived from the dynamic plugin registry.

``PARSER_REGISTRY`` keeps its historical name and shape (vendor → parser
class) for existing consumers, but is now built from
``plugins.discover_plugins()`` instead of hardcoded imports.
"""
from plugins import parser_registry

PARSER_REGISTRY: dict[str, type] = parser_registry()

__all__ = ["PARSER_REGISTRY"]
