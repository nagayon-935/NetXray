import asyncio
import logging
import json
import datetime
from typing import Dict, Set, List, Any
from fastapi import WebSocket

logger = logging.getLogger(__name__)

class TelemetryManager:
    def __init__(self):
        # Map topology_name -> Set of active WebSocket connections
        self.connections: Dict[str, Set[WebSocket]] = {}
        # Active gNMI client subscriptions
        self.subscriptions: Dict[str, Any] = {}

    async def connect(self, topology_name: str, websocket: WebSocket):
        await websocket.accept()
        self.connections.setdefault(topology_name, set()).add(websocket)
        logger.info(f"WebSocket connected for topology: {topology_name}")

    def disconnect(self, topology_name: str, websocket: WebSocket):
        if topology_name in self.connections:
            self.connections[topology_name].remove(websocket)
            if not self.connections[topology_name]:
                del self.connections[topology_name]
        logger.info(f"WebSocket disconnected for topology: {topology_name}")

    async def broadcast_patch(self, topology_name: str, patch: List[Dict[str, Any]]):
        """ Broadcast a JSON Patch (RFC 6902) list to all clients for a topology. """
        if topology_name not in self.connections:
            return
        
        message = json.dumps(patch)
        disconnected = set()
        for ws in self.connections[topology_name]:
            try:
                await ws.send_text(message)
            except Exception as e:
                logger.error(f"Error sending message to client: {e}")
                disconnected.add(ws)
        
        for ws in disconnected:
            self.disconnect(topology_name, ws)

    async def push_mock_telemetry(self, topology_name: str, node_id: str, iface_name: str):
        """ Generate mock telemetry and broadcast as JSON Patch for demonstration. """
        import random
        while True:
            if topology_name not in self.connections:
                break
            
            traffic_in = random.randint(1000, 1000000)
            traffic_out = random.randint(1000, 1000000)
            now = datetime.datetime.now().isoformat()
            
            # JSON Patch to update specific interface counters
            # Path structure in IR: /topology/nodes/INDEX/interfaces/IF_NAME/traffic_in_bps
            # For simplicity, we assume we know the index or use a more direct pathing if possible.
            # Here we just send a mock update structure.
            patch = [
                {"op": "replace", "path": f"/nodes/{node_id}/interfaces/{iface_name}/traffic_in_bps", "value": traffic_in},
                {"op": "replace", "path": f"/nodes/{node_id}/interfaces/{iface_name}/traffic_out_bps", "value": traffic_out},
                {"op": "replace", "path": f"/nodes/{node_id}/interfaces/{iface_name}/last_updated", "value": now}
            ]
            
            await self.broadcast_patch(topology_name, patch)
            await asyncio.sleep(2)

telemetry_manager = TelemetryManager()
