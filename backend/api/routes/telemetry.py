import asyncio
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import List, Dict
from backend.collector.telemetry_manager import telemetry_manager

router = APIRouter(prefix="/telemetry", tags=["telemetry"])

class TelemetrySubscribeRequest(BaseModel):
    topology_name: str
    nodes: List[str]  # List of node IDs to subscribe to

@router.post("/subscribe")
async def subscribe_telemetry(req: TelemetrySubscribeRequest, background_tasks: BackgroundTasks):
    """ Start gNMI subscriptions for given nodes. """
    # In a real app, we'd start actual gNMI clients here.
    # For demo, we start a mock push task for each requested node.
    for node_id in req.nodes:
        # Mocking an interface for the node
        background_tasks.add_task(telemetry_manager.push_mock_telemetry, req.topology_name, node_id, "eth1")
    
    return {"status": "subscribed", "nodes": req.nodes}

@router.get("/status")
async def get_telemetry_status():
    return {"active_connections": {topo: len(conns) for topo, conns in telemetry_manager.connections.items()}}
