import yaml
from typing import Dict, Any
from translator.iac.vendor_utils import map_vendor_from_os

def parse_ansible_inventory(inventory_content: str) -> Dict[str, Any]:
    """
    Parse Ansible inventory YAML to extract node information.
    Note: Inventory usually lacks link information.
    """
    data = yaml.safe_load(inventory_content)
    nodes = []

    def extract_hosts(block: Any):
        if not isinstance(block, dict): return
        
        # Format: hosts: { node1: { var1: val1 } }
        hosts = block.get("hosts", {})
        for node_id, attrs in hosts.items():
            vendor = map_vendor_from_os(attrs.get("ansible_network_os", "generic"))
            
            nodes.append({
                "id": node_id,
                "type": "router",
                "vendor": vendor,
                "interfaces": {}
            })
        
        # Format: children: { group1: { hosts: ... } }
        children = block.get("children", {})
        for group, group_block in children.items():
            extract_hosts(group_block)

    extract_hosts(data.get("all", data))
    
    return {
        "ir_version": "0.3.0",
        "topology": {
            "nodes": nodes,
            "links": []
        }
    }
