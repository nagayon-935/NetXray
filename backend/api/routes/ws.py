from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from collector.telemetry_manager import telemetry_manager

router = APIRouter(prefix="/ws", tags=["websocket"])

@router.websocket("/topology/{topology_name}")
async def websocket_endpoint(websocket: WebSocket, topology_name: str):
    await telemetry_manager.connect(topology_name, websocket)
    try:
        while True:
            # Keep connection alive and wait for any messages from client if needed
            data = await websocket.receive_text()
            # Handle client-to-server messages if any
    except WebSocketDisconnect:
        telemetry_manager.disconnect(topology_name, websocket)
