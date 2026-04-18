import json

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


@router.websocket("/lab/{run_id}")
async def lab_log_endpoint(websocket: WebSocket, run_id: str) -> None:
    """
    Stream lab lifecycle logs (stdout/stderr) for a given run_id.
    Replays buffered lines first so late-joining clients catch up.
    """
    from collector.clab_lifecycle import get_run_logs

    await telemetry_manager.connect_lab_log(run_id, websocket)
    try:
        for line in get_run_logs(run_id):
            try:
                await websocket.send_text(json.dumps({"type": "log", "line": line}))
            except Exception:
                return
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        telemetry_manager.disconnect_lab_log(run_id, websocket)
