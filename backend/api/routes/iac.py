"""IaC route — clab YAML export + direct deploy from IR.

Flows:
1. Preview: POST /iac/export/clab  → IR → YAML text (no side effects)
2. Clone:   POST /iac/clone-to-clab → writes YAML + per-node configs and
           launches `containerlab deploy`. Used by "Apply to clab" and
           "Scan & Clone".
"""

from pathlib import Path
from typing import Any, Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from api.config import settings
from api.schemas import ClabYamlImportRequest, CloneToClabRequest
from collector.clab_lifecycle import active_run_id, is_running, start_lifecycle
from collector.telemetry_manager import telemetry_manager
from plugins import get_plugin
from translator.clab_yaml_importer import import_from_yaml
from translator.iac.clab_exporter import (
    build_clab_yaml,
    export_to_clab,
    validate_ir_for_clone,
)

router = APIRouter(prefix="/iac", tags=["iac"])


def _clab_exports_dir() -> Path:
    path = settings.data_dir.parent / "clab-exports"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _safe(name: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in name)
    return safe or "netxray-clone"


async def _broadcast(run_id: str, payload: dict) -> None:
    await telemetry_manager.broadcast_lab_log(run_id, payload)


class IacExportClabRequest(BaseModel):
    ir: Dict[str, Any]


@router.post("/export/clab")
async def export_clab(req: IacExportClabRequest):
    """Export NetXray-IR to containerlab YAML (preview only — no files written)."""
    try:
        return {"clab_yaml": build_clab_yaml(req.ir)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Clab export failed: {str(e)}")


class DeployClabRequest(BaseModel):
    clab_yaml: str
    topo_name: str = "netxray-exported"


@router.post("/deploy-clab")
async def deploy_clab_direct(req: DeployClabRequest) -> dict:
    """[legacy] Save YAML to disk and deploy via containerlab. Prefer /clone-to-clab."""
    if is_running():
        raise HTTPException(status_code=409, detail=f"Lifecycle op in progress (run_id={active_run_id()})")

    safe_name = _safe(req.topo_name)
    topo_path = _clab_exports_dir() / f"{safe_name}.clab.yml"
    topo_path.write_text(req.clab_yaml, encoding="utf-8")

    try:
        run_id = await start_lifecycle("deploy", str(topo_path), [], _broadcast)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    return {"run_id": run_id, "topology_file": str(topo_path)}


@router.post("/from-clab-yaml")
async def import_clab_yaml(req: ClabYamlImportRequest) -> dict:
    """Convert a containerlab YAML text into a NetXray-IR dict (static, no deploy)."""
    try:
        ir = import_from_yaml(req.yaml_text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"YAML import failed: {exc}")
    if not ir.get("topology", {}).get("nodes"):
        raise HTTPException(status_code=400, detail="No nodes found in YAML")
    return ir


@router.post("/clone-to-clab")
async def clone_to_clab(req: CloneToClabRequest) -> dict:
    """Write a clab project (YAML + per-node configs) and deploy it.

    Returns {run_id, topology_file}. Frontend attaches run_id to the WS log stream
    via /api/ws/lab-logs/{run_id}.
    """
    errors = validate_ir_for_clone(req.ir)
    if errors:
        raise HTTPException(status_code=400, detail="; ".join(errors))

    if is_running():
        raise HTTPException(
            status_code=409, detail=f"Lifecycle op in progress (run_id={active_run_id()})"
        )

    safe_name = _safe(req.topo_name)
    output_dir = _clab_exports_dir() / safe_name

    try:
        yaml_path = export_to_clab(req.ir, output_dir)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Clab export failed: {exc}")

    try:
        run_id = await start_lifecycle("deploy", str(yaml_path), [], _broadcast)
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc))

    return {"run_id": run_id, "topology_file": str(yaml_path)}


# ── Config generation ──────────────────────────────────────────────────────────

class ConfigGenerateRequest(BaseModel):
    node: Dict[str, Any]
    vendor: str = "generic"


@router.post("/config/generate")
async def generate_node_config(req: ConfigGenerateRequest) -> dict:
    """Generate a startup config text from an IR node dict.

    Returns {"config": "<text>"}.  Supported vendors: frr, arista.
    Generic fallback is used for other vendors.
    """
    plugin = get_plugin(req.vendor)
    if plugin is not None:
        gen = plugin.config_generator_class()
    else:
        from plugins.base_config_generator import BaseConfigGenerator
        gen = BaseConfigGenerator()

    try:
        config_text = gen.generate_startup_config(req.node)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Config generation failed: {exc}")

    return {"config": config_text, "vendor": req.vendor}
