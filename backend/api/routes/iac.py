from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Literal
from backend.translator.iac.terraform_parser import parse_terraform_to_ir
from backend.translator.iac.ansible_parser import parse_ansible_inventory
from backend.translator.iac.clab_exporter import export_to_clab

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
