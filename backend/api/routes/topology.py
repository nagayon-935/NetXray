import json
import logging
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

from api.config import settings
from api.schemas import SaveResponse, TopologyListResponse, TopologyMeta
from api.state import set_current_ir

logger = logging.getLogger(__name__)
router = APIRouter()

# Only allow alphanumeric, hyphens, and underscores in topology names.
_NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,128}$")


def _topo_path(name: str) -> Path:
    """Return the filesystem path for a topology, with path-traversal protection."""
    if not _NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid topology name: only letters, digits, hyphens, and underscores are allowed",
        )
    # Resolve to an absolute path and verify it stays inside data_dir
    candidate = (settings.data_dir / f"{name}.json").resolve()
    base = settings.data_dir.resolve()
    if not candidate.is_relative_to(base):
        raise HTTPException(status_code=400, detail="Invalid topology name")
    return candidate


@router.get("/topologies", response_model=TopologyListResponse)
def list_topologies() -> TopologyListResponse:
    topologies: list[TopologyMeta] = []
    for p in sorted(settings.data_dir.glob("*.json")):
        try:
            ir = json.loads(p.read_text())
            nodes = ir.get("topology", {}).get("nodes", [])
            links = ir.get("topology", {}).get("links", [])
            topologies.append(TopologyMeta(name=p.stem, node_count=len(nodes), link_count=len(links)))
        except Exception:
            continue
    return TopologyListResponse(topologies=topologies)


@router.get("/topology/{name}")
def get_topology(name: str) -> Any:
    path = _topo_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Topology '{name}' not found")
    ir = json.loads(path.read_text())
    set_current_ir(ir)
    return ir


@router.post("/topology/{name}", response_model=SaveResponse)
def save_topology(name: str, ir: dict[str, Any]) -> SaveResponse:
    _validate_ir(ir)
    path = _topo_path(name)
    path.write_text(json.dumps(ir, indent=2))
    set_current_ir(ir)
    return SaveResponse(status="saved", name=name)


@router.delete("/topology/{name}")
def delete_topology(name: str) -> dict[str, str]:
    path = _topo_path(name)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Topology '{name}' not found")
    path.unlink()
    return {"status": "deleted", "name": name}


def _validate_ir(ir: Any) -> None:
    """Validate IR against the JSON schema. Raises HTTP 422 on schema violation."""
    schema_path = settings.schema_path
    if not schema_path.exists():
        logger.warning("Schema file not found at %s — IR validation skipped", schema_path)
        return
    try:
        import jsonschema
        schema = json.loads(schema_path.read_text())
        jsonschema.validate(ir, schema)
    except jsonschema.ValidationError as e:
        raise HTTPException(status_code=422, detail=f"IR validation error: {e.message}")
    except jsonschema.exceptions.SchemaError as e:
        logger.error("Schema file is invalid: %s", e)
        raise HTTPException(status_code=500, detail="Server schema configuration error")
