"""Lab lifecycle API — deploy / destroy / redeploy containerlab topologies."""

import os
import re

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, field_validator

from api.config import settings
from collector.clab_lifecycle import (
    active_run_id,
    get_run_logs,
    is_running,
    start_lifecycle,
)
from collector.telemetry_manager import telemetry_manager

router = APIRouter(prefix="/lab", tags=["lab"])

# Topology names use only word chars, dots, slashes, hyphens, spaces. Extension is optional.
_SAFE_PATH = re.compile(r'^[\w./ _\-]+(?:\.ya?ml)?$')


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


def _resolve_topo(path: str) -> str:
    if not path:
        return path
        
    # If absolute or relative to current dir, try it first
    if path.startswith("/") or path.startswith("."):
        if os.path.exists(path):
            return path
        for ext in [".clab.yml", ".clab.yaml"]:
            if os.path.exists(path + ext):
                return path + ext
        return path

    # Try resolving against labs directory
    base = settings.clab_labs_dir
    # 1. Try original path
    potential = base / path
    if potential.exists():
        return str(potential)
    
    # 2. Try with extensions
    for ext in [".clab.yml", ".clab.yaml"]:
        potential = base / (path + ext)
        if potential.exists():
            return str(potential)
            
    return path


@router.post("/deploy")
async def deploy(req: LifecycleRequest) -> dict:
    """Deploy a containerlab topology. Returns run_id; progress streams via WS."""
    _busy_check()
    topo = _resolve_topo(req.topology_file)
    extra = ["--reconfigure"] if req.reconfigure else []
    try:
        run_id = await start_lifecycle("deploy", topo, extra, _broadcast)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"run_id": run_id}


@router.post("/destroy")
async def destroy(req: LifecycleRequest) -> dict:
    """Destroy a running containerlab topology."""
    _busy_check()
    topo = _resolve_topo(req.topology_file)
    extra = ["--cleanup"] if req.cleanup else []
    try:
        run_id = await start_lifecycle("destroy", topo, extra, _broadcast)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"run_id": run_id}


@router.post("/redeploy")
async def redeploy(req: LifecycleRequest) -> dict:
    """Destroy then re-deploy a containerlab topology using 'deploy --reconfigure'."""
    _busy_check()
    topo = _resolve_topo(req.topology_file)
    # containerlab doesn't have a 'redeploy' command. Use 'deploy --reconfigure'.
    extra = ["--reconfigure"]
    if req.cleanup:
        extra.append("--cleanup")
    try:
        run_id = await start_lifecycle("deploy", topo, extra, _broadcast)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"run_id": run_id}


@router.get("/status")
async def status() -> dict:
    return {"running": is_running(), "run_id": active_run_id()}


@router.get("/logs/{run_id}")
async def logs(run_id: str) -> dict:
    return {"logs": get_run_logs(run_id)}
