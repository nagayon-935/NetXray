import yaml
from typing import Dict, Any

def export_to_clab(ir: Dict[str, Any]) -> str:
    """
    Export NetXray-IR to containerlab .clab.yml format.
    """
    clab = {
        "name": ir.get("metadata", {}).get("name", "netxray-exported"),
        "topology": {
            "nodes": {},
            "links": []
        }
    }

    # Map vendors to containerlab kinds
    vendor_map = {
        "arista": "ceos",
        "frr": "frr",
        "generic": "linux"
    }

    # Add nodes
    for node in ir.get("topology", {}).get("nodes", []):
        node_id = node["id"]
        vendor = node.get("vendor", "generic")
        kind = vendor_map.get(vendor, "linux")
        
        clab["topology"]["nodes"][node_id] = {
            "kind": kind,
        }
        if node.get("hostname"):
            clab["topology"]["nodes"][node_id]["hostname"] = node["hostname"]

    # Add links
    for link in ir.get("topology", {}).get("links", []):
        src = link["source"]
        tgt = link["target"]
        
        clab["topology"]["links"].append({
            "endpoints": [
                f"{src['node']}:{src['interface']}",
                f"{tgt['node']}:{tgt['interface']}"
            ]
        })

    return yaml.dump(clab, sort_keys=False)
