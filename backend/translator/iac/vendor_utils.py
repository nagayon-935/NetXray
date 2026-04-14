def map_vendor_from_kind(kind: str) -> str:
    """containerlab kind 文字列からベンダー名を返す。"""
    k = kind.lower()
    if "ceos" in k or "arista" in k: return "arista"
    if "frr" in k: return "frr"
    return "generic"

def map_vendor_from_os(network_os: str) -> str:
    """ansible_network_os 値からベンダー名を返す。"""
    o = network_os.lower()
    if "eos" in o or "arista" in o: return "arista"
    if "frr" in o: return "frr"
    return "generic"