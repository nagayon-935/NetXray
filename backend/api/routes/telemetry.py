"""
Telemetry REST endpoints.

These allow clients to manually start/stop mock-telemetry loops and inspect
the current status — useful for testing without a WebSocket connection.

In a production deployment the subscribe endpoint would also kick off real
gNMI subscriptions via gnmi_client.GnmiClient.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Any
from collector.telemetry_manager import telemetry_manager

router = APIRouter(prefix="/telemetry", tags=["telemetry"])


class TelemetrySubscribeRequest(BaseModel):
    topology_name: str
    nodes: list[str] = []  # Node IDs to watch (hint for gNMI; mock ignores this)


# ── Subscribe ─────────────────────────────────────────────────────────────────

@router.post("/subscribe")
async def subscribe_telemetry(req: TelemetrySubscribeRequest) -> dict[str, Any]:
    """
    Start the mock-telemetry loop for a topology.

    Uses ``asyncio.create_task`` (not BackgroundTasks) so the persistent
    coroutine survives the HTTP request/response lifecycle.
    """
    started = telemetry_manager.start_for_topology(req.topology_name)
    return {
        "status": "started" if started else "already_running",
        "topology": req.topology_name,
        "nodes": req.nodes,
    }


# ── Unsubscribe ───────────────────────────────────────────────────────────────

@router.delete("/subscribe/{topology_name}")
async def unsubscribe_telemetry(topology_name: str) -> dict[str, Any]:
    """Stop the mock-telemetry loop for a topology."""
    stopped = telemetry_manager.stop_for_topology(topology_name)
    if not stopped:
        raise HTTPException(
            status_code=404,
            detail=f"No active telemetry loop for topology '{topology_name}'",
        )
    return {"status": "stopped", "topology": topology_name}


# ── Status ────────────────────────────────────────────────────────────────────

@router.get("/status")
async def get_telemetry_status() -> dict[str, Any]:
    """Return the number of active WebSocket connections and running loops."""
    return telemetry_manager.status
