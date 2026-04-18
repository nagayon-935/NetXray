"""Packet capture API — start/stop/list tcpdump sessions per link endpoint."""

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from collector.capture_manager import (
    PRESET_FILTERS,
    list_captures,
    start_capture,
    stop_capture,
)

router = APIRouter(prefix="/capture", tags=["capture"])


class StartCaptureRequest(BaseModel):
    node: str
    interface: str
    filter: str = ""
    preset: str | None = None  # one of bgp|ospf|isis|evpn|all


@router.post("/start")
async def capture_start(req: StartCaptureRequest) -> dict:
    """Start a tcpdump session; connect to /api/ws/capture/{id} to receive pcap chunks."""
    tcpdump_filter = req.filter
    if req.preset and req.preset in PRESET_FILTERS:
        tcpdump_filter = PRESET_FILTERS[req.preset]

    # start_capture without a send_fn — data arrives via the WS endpoint below
    try:
        session_id = await start_capture(req.node, req.interface, tcpdump_filter, None)
    except RuntimeError as exc:
        raise HTTPException(status_code=429, detail=str(exc))

    return {"id": session_id}


@router.delete("/{session_id}")
async def capture_stop(session_id: str) -> dict:
    await stop_capture(session_id)
    return {"ok": True}


@router.get("/list")
async def capture_list() -> dict:
    return {"captures": list_captures()}


@router.get("/presets")
async def capture_presets() -> dict:
    return {"presets": {k: v for k, v in PRESET_FILTERS.items()}}


# ── WebSocket streaming endpoint ──────────────────────────────────────────────

@router.websocket("/ws/{session_id}")
async def capture_ws(websocket: WebSocket, session_id: str) -> None:
    """
    Stream raw pcap bytes (base64-encoded) for an active capture session.
    The client posts to /api/capture/start first, gets a session_id, then
    opens this WebSocket to receive the byte stream.
    """
    from collector.capture_manager import _sessions, start_capture, PRESET_FILTERS
    import asyncio

    await websocket.accept()

    # If session already started (via /start), replace its send_fn
    session = _sessions.get(session_id)
    if session is None:
        await websocket.send_text('{"error":"session not found"}')
        await websocket.close()
        return

    async def _send(encoded: str) -> None:
        await websocket.send_text(encoded)

    session._send_fn = _send

    try:
        # Wait until the session task finishes or client disconnects
        while session_id in _sessions:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=5.0)
            except asyncio.TimeoutError:
                continue
    except WebSocketDisconnect:
        pass
    finally:
        await stop_capture(session_id)
