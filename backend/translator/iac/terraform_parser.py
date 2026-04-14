import hcl2
from typing import Dict, Any, List
from translator.iac.vendor_utils import map_vendor_from_kind


def _strip_quotes(s: str) -> str:
    """Strip surrounding double-quotes that the hcl2 library preserves in keys/values."""
    if isinstance(s, str) and s.startswith('"') and s.endswith('"'):
        return s[1:-1]
    return s


def parse_terraform_to_ir(hcl_content: str) -> Dict[str, Any]:
    """
    Parse terraform HCL (e.g. for a containerlab terraform provider)
    into a NetXray-IR.
    """
    data = hcl2.loads(hcl_content)

    nodes = []
    links = []

    # Map nodes (mock logic based on common patterns)
    # Looking for: resource "clab_node" "name" { kind = "ceos" ... }
    for resource_block in data.get("resource", []):
        for resource_type, resources in resource_block.items():
            resource_type_clean = _strip_quotes(resource_type)
            if "node" in resource_type_clean:
                for name, attrs in resources.items():
                    node_id = _strip_quotes(name)
                    kind_attr = attrs.get("kind", ["generic"])
                    kind = kind_attr[0] if isinstance(kind_attr, list) and len(kind_attr) > 0 else (kind_attr if isinstance(kind_attr, str) else "generic")
                    kind = _strip_quotes(kind)
                    vendor = map_vendor_from_kind(kind)

                    nodes.append({
                        "id": node_id,
                        "type": "router", # default for terraform-clab nodes
                        "vendor": vendor,
                        "interfaces": {}
                    })

            if "link" in resource_type_clean:
                for name, attrs in resources.items():
                    endpoints_attr = attrs.get("endpoints", [])
                    # HCL2 might parse a list inside a block as a list of lists.
                    endpoints = endpoints_attr[0] if isinstance(endpoints_attr, list) and len(endpoints_attr) > 0 and isinstance(endpoints_attr[0], list) else endpoints_attr

                    if isinstance(endpoints, list) and len(endpoints) >= 2:
                        ep1 = _strip_quotes(endpoints[0])
                        ep2 = _strip_quotes(endpoints[1])
                        ep1_parts = ep1.split(":")
                        ep2_parts = ep2.split(":")
                        if len(ep1_parts) == 2 and len(ep2_parts) == 2:
                            links.append({
                                "id": f"{ep1_parts[0]}-{ep2_parts[0]}",
                                "source": {"node": ep1_parts[0], "interface": ep1_parts[1]},
                                "target": {"node": ep2_parts[0], "interface": ep2_parts[1]},
                                "state": "up"
                            })

    return {
        "ir_version": "0.3.0",
        "topology": {
            "nodes": nodes,
            "links": links
        }
    }
