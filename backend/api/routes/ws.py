import json

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from collector.telemetry_manager import telemetry_manager

router = APIRouter(prefix="/ws", tags=["websocket"])


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
