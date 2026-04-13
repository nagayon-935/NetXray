from plugins.frr.parser import FrrParser
from plugins.arista.parser import AristaParser

PARSER_REGISTRY: dict[str, type] = {
    "frr": FrrParser,
    "arista": AristaParser,
}

__all__ = ["FrrParser", "AristaParser", "PARSER_REGISTRY"]
