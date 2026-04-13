from fastapi import APIRouter, HTTPException
from api.schemas import ConfigGenerateRequest
from plugins import get_plugin

router = APIRouter(prefix="/config", tags=["config"])

@router.post("/generate")
async def generate_config(req: ConfigGenerateRequest):
    """
    Generate vendor-specific configuration commands for a given node
    based on the difference between base_ir and target_ir.
    """
    node_id = req.node_id
    
    # Find the node in both IRs
    base_nodes = {n["id"]: n for n in req.base_ir.get("nodes", [])}
    target_nodes = {n["id"]: n for n in req.target_ir.get("nodes", [])}
    
    if node_id not in target_nodes:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found in target IR")
    
    target_node = target_nodes[node_id]
    base_node = base_nodes.get(node_id, {"id": node_id, "interfaces": [], "acls": {}})
    
    vendor = target_node.get("vendor", "frr")
    plugin = get_plugin(vendor)
    if not plugin:
        raise HTTPException(status_code=400, detail=f"Unsupported vendor: {vendor}")
    
    generator = plugin.config_generator_class()
    commands = generator.generate_full_diff(base_node, target_node)
    
    return {
        "node_id": node_id,
        "vendor": vendor,
        "commands": commands
    }
