from plugins.frr.parser import FrrParser
from plugins.arista.parser import AristaParser
from plugins.generic_parser import GenericParser

PARSER_REGISTRY: dict[str, type] = {
    "frr": FrrParser,
    "arista": AristaParser,
    "generic": GenericParser,
}

__all__ = ["FrrParser", "AristaParser", "PARSER_REGISTRY"]
