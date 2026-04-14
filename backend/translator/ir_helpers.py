def get_ir_nodes(ir: dict) -> list[dict]:
    return (ir.get("topology") or {}).get("nodes") or []

def get_ir_links(ir: dict) -> list[dict]:
    return (ir.get("topology") or {}).get("links") or []

def get_node_interfaces(node: dict) -> dict:
    """Interface を dict 形式で返す。旧リスト形式も正規化する。"""
    ifaces = node.get("interfaces") or {}
    if isinstance(ifaces, list):
        return {i["name"]: i for i in ifaces if "name" in i}
    return ifaces