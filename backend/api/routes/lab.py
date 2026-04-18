"""Lab lifecycle API — deploy / destroy / redeploy containerlab topologies."""

import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from collector.clab_lifecycle import (
    active_run_id,
    get_run_logs,
    is_running,
    start_lifecycle,
)
from collector.telemetry_manager import telemetry_manager

router = APIRouter(prefix="/lab", tags=["lab"])

# Topology names use only word chars, dots, slashes, hyphens, spaces
_SAFE_PATH = re.compile(r'^[\w./ _\-]+\.ya?ml$')


class LifecycleRequest(BaseModel):
    topology_file: str
    cleanup: bool = False
    reconfigure: bool = False

    @field_validator("topology_file")
    @classmethod
    def validate_path(cls, v: str) -> str:
        if not _SAFE_PATH.match(v):
            raise ValueError("topology_file must be a .yml/.yaml path (no shell metacharacters)")
        return v


async def _broadcast(run_id: str, payload: dict) -> None:
    await telemetry_manager.broadcast_lab_log(run_id, payload)


def _busy_check() -> None:
    if is_running():
        raise HTTPException(status_code=409, detail=f"Lifecycle op in progress (run_id={active_run_id()})")


@router.post("/deploy")
async def deploy(req: LifecycleRequest) -> dict:
    """Deploy a containerlab topology. Returns run_id; progress streams via WS."""
    _busy_check()
    extra = ["--reconfigure"] if req.reconfigure else []
    try:
        run_id = await start_lifecycle("deploy", req.topology_file, extra, _broadcast)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"run_id": run_id}


@router.post("/destroy")
async def destroy(req: LifecycleRequest) -> dict:
    """Destroy a running containerlab topology."""
    _busy_check()
    extra = ["--cleanup"] if req.cleanup else []
    try:
        run_id = await start_lifecycle("destroy", req.topology_file, extra, _broadcast)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    # Stop event stream since the lab is going down
    telemetry_manager.stop_event_stream("default")
    return {"run_id": run_id}


@router.post("/redeploy")
async def redeploy(req: LifecycleRequest) -> dict:
    """Destroy then re-deploy a containerlab topology."""
    _busy_check()
    extra = ["--cleanup"] if req.cleanup else []
    try:
        run_id = await start_lifecycle("redeploy", req.topology_file, extra, _broadcast)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"run_id": run_id}


@router.get("/status")
async def status() -> dict:
    return {"running": is_running(), "run_id": active_run_id()}


@router.get("/logs/{run_id}")
async def logs(run_id: str) -> dict:
    return {"logs": get_run_logs(run_id)}


@router.post("/events/start")
async def start_events(topology_name: str = "default", lab_name: str = "") -> dict:
    """Manually start docker event streaming for a deployed lab."""
    if not lab_name:
        raise HTTPException(status_code=400, detail="lab_name is required")
    await telemetry_manager.start_event_stream(topology_name, lab_name)
    return {"ok": True}


@router.post("/events/stop")
async def stop_events(topology_name: str = "default") -> dict:
    """Stop docker event streaming."""
    telemetry_manager.stop_event_stream(topology_name)
    return {"ok": True}
