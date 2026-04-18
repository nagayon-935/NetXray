import uuid
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Literal

from api.config import settings
from translator.iac.terraform_parser import parse_terraform_to_ir
from translator.iac.ansible_parser import parse_ansible_inventory
from translator.iac.clab_exporter import export_to_clab
from collector.clab_lifecycle import active_run_id, is_running, start_lifecycle
from collector.telemetry_manager import telemetry_manager

router = APIRouter(prefix="/iac", tags=["iac"])

class IacImportRequest(BaseModel):
    type: Literal["terraform", "ansible"]
    content: str

class IacExportClabRequest(BaseModel):
    ir: Dict[str, Any]

@router.post("/import")
async def import_iac(req: IacImportRequest):
    """
    Import IaC configuration (Terraform or Ansible) and convert it to NetXray-IR.
    """
    try:
        if req.type == "terraform":
            ir = parse_terraform_to_ir(req.content)
        elif req.type == "ansible":
            ir = parse_ansible_inventory(req.content)
        else:
            raise HTTPException(status_code=400, detail="Unsupported IaC type")
        
        return {"ir": ir}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"IaC import failed: {str(e)}")

@router.post("/export/clab")
async def export_clab(req: IacExportClabRequest):
    """
    Export NetXray-IR to containerlab YAML.
    """
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

    # Write YAML to a stable path in the data dir
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
