"""IaC route — clab YAML export + direct deploy from IR.

Used by the topology editor's "Apply to clab" flow:
1. Frontend POSTs current IR to /iac/export/clab → receives clab YAML
2. Frontend POSTs YAML to /iac/deploy-clab → starts containerlab deploy
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any

from api.config import settings
from translator.iac.clab_exporter import export_to_clab
from collector.clab_lifecycle import active_run_id, is_running, start_lifecycle
from collector.telemetry_manager import telemetry_manager

router = APIRouter(prefix="/iac", tags=["iac"])


class IacExportClabRequest(BaseModel):
    ir: Dict[str, Any]


@router.post("/export/clab")
async def export_clab(req: IacExportClabRequest):
    """Export NetXray-IR to containerlab YAML."""
    try:
        clab_yaml = export_to_clab(req.ir)
        return {"clab_yaml": clab_yaml}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clab export failed: {str(e)}")


class DeployClabRequest(BaseModel):
    clab_yaml: str
    topo_name: str = "netxray-exported"


async def _broadcast(run_id: str, payload: dict) -> None:
    await telemetry_manager.broadcast_lab_log(run_id, payload)


@router.post("/deploy-clab")
async def deploy_clab_direct(req: DeployClabRequest) -> dict:
    """Save YAML to disk and deploy via containerlab. Returns run_id for WS log streaming."""
    if is_running():
        raise HTTPException(status_code=409, detail=f"Lifecycle op in progress (run_id={active_run_id()})")

    clab_dir = settings.data_dir.parent / "clab-exports"
    clab_dir.mkdir(parents=True, exist_ok=True)
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in req.topo_name)
    topo_path = clab_dir / f"{safe_name}.clab.yml"
    topo_path.write_text(req.clab_yaml, encoding="utf-8")

    try:
        run_id = await start_lifecycle("deploy", str(topo_path), [], _broadcast)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"run_id": run_id, "topology_file": str(topo_path)}
