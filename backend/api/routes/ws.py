from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from collector.telemetry_manager import telemetry_manager

router = APIRouter(prefix="/ws", tags=["websocket"])


@router.websocket("/topology/{topology_name}")
async def websocket_endpoint(websocket: WebSocket, topology_name: str) -> None:
    """
    WebSocket endpoint for streaming telemetry patches.

    * Accepts the connection and registers the client.
    * Automatically starts the mock-telemetry loop for *topology_name*
      (if not already running) so the client immediately receives data.
    * Keeps the connection open; the client may send plain-text messages
      (ignored for now, reserved for future client→server commands).
    * Cleans up on disconnect.
    """
    await telemetry_manager.connect(topology_name, websocket)
    try:
        while True:
            # Keep the receive loop alive so the disconnect event is detected.
            # We don't currently process client→server messages.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        telemetry_manager.disconnect(topology_name, websocket)
