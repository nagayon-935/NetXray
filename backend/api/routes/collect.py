import json
import logging

from fastapi import APIRouter, HTTPException

from api.config import settings
from api.routes.topology import _topo_path, _validate_ir
from api.schemas import CollectRequest

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/collect")
def collect_topology(req: CollectRequest) -> dict:
    """
    Collect topology data from containerlab nodes and build NetXray-IR.
    Falls back to mock IR if containerlab / SSH is unavailable.
    """
    try:
        from collector.clab import inspect_lab
        from collector.drivers import DRIVER_REGISTRY
        from translator.ir_builder import build_ir
        from translator.parsers import PARSER_REGISTRY

        nodes = inspect_lab(req.clab_topology)
        if not nodes:
            raise HTTPException(status_code=500, detail="No nodes found in containerlab topology")

        driver_outputs: dict[str, dict[str, str]] = {}
        errors: list[str] = []
        for node in nodes:
            vendor = node.vendor
            driver_cls = DRIVER_REGISTRY.get(vendor)
            if driver_cls is None:
                logger.warning("No driver for vendor '%s' (node %s), skipping", vendor, node.name)
                continue

            # Determine credentials: 
            # 1. Use credentials from request if provided.
            # 2. Use vendor-specific default if available in settings.
            # 3. Fallback to general clab settings.
            if req.credentials:
                node_creds = req.credentials
            else:
                node_creds = settings.clab_default_creds.get(vendor, {
                    "username": settings.clab_ssh_user,
                    "password": settings.clab_ssh_password,
                })

            try:
                driver = driver_cls()
                # Use full container name (node.name) for collection.
                # Drivers using 'docker exec' require the full name.
                driver_outputs[node.name] = driver.collect(
                    node.mgmt_ip, node_creds, node_name=node.name
                )
            except Exception as exc:
                logger.warning("Failed to collect from %s: %s", node.name, exc)
                errors.append(f"{node.name}: {exc}")

        ir = build_ir(nodes, driver_outputs, PARSER_REGISTRY)
        _validate_ir(ir)

        path = _topo_path(req.topology_name)
        path.write_text(json.dumps(ir, indent=2))
        logger.info("Saved topology '%s' (%d nodes)", req.topology_name, len(nodes))
        return ir

    except HTTPException:
        raise
    except Exception as exc:
        # Log the full exception (may contain SSH details) but return only a
        # generic message to the client to avoid leaking internal infrastructure.
        logger.exception("Collection failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail="Topology collection failed. Check server logs for details.",
        )
