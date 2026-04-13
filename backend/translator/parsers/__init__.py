from translator.parsers.frr import FrrParser
from translator.parsers.arista import AristaParser

PARSER_REGISTRY: dict[str, type] = {
    "frr": FrrParser,
    "arista": AristaParser,
}

__all__ = ["FrrParser", "AristaParser", "PARSER_REGISTRY"]
