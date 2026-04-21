import json
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

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
        from collector.clab import (
            inspect_lab,
            get_links_from_topo,
            get_topo_file_from_container,
        )
        from collector.drivers import DRIVER_REGISTRY
        from translator.ir_builder import build_ir
        from translator.parsers import PARSER_REGISTRY

        topo_path = req.clab_topology
        if topo_path:
            from api.routes.lab import _resolve_topo
            topo_path = _resolve_topo(topo_path)

        nodes = inspect_lab(topo_path)
        if not nodes:
            raise HTTPException(status_code=500, detail="No nodes found in containerlab topology")

        # Extract explicit links from .clab.yml. If the user passed a lab name
        # (not a real path), _resolve_topo returns the name unchanged and the
        # yaml read fails silently; recover via the clab-topo-file label on
        # any running node container.
        clab_links = get_links_from_topo(topo_path) if topo_path else []
        if not clab_links:
            for node in nodes:
                detected = get_topo_file_from_container(node.name)
                if detected:
                    logger.info(
                        "Auto-detected topology file via clab-topo-file label: %s", detected
                    )
                    clab_links = get_links_from_topo(detected)
                    break
            if not clab_links:
                logger.warning(
                    "No clab YAML links available (topo_path=%r); falling back to "
                    "IP-subnet inference — unnumbered and L2-only links will be missing.",
                    topo_path,
                )

        driver_outputs: dict[str, dict[str, str]] = {}
        errors: list[str] = []

        def _collect_one(node) -> tuple[str, dict[str, str] | None, str | None]:
            vendor = node.vendor
            driver_cls = DRIVER_REGISTRY.get(vendor)
            if driver_cls is None:
                logger.warning(
                    "No driver for vendor '%s' (node %s), skipping", vendor, node.name
                )
                return node.name, None, None

            if req.credentials:
                node_creds = req.credentials
            else:
                node_creds = settings.clab_default_creds.get(
                    vendor,
                    {
                        "username": settings.clab_ssh_user,
                        "password": settings.clab_ssh_password,
                    },
                )

            try:
                driver = driver_cls()
                outputs = driver.collect(
                    node.mgmt_ip, node_creds, node_name=node.name
                )
                return node.name, outputs, None
            except Exception as exc:
                logger.warning("Failed to collect from %s: %s", node.name, exc)
                return node.name, None, f"{node.name}: {exc}"

        # Collection is I/O bound (each node runs several `docker exec` or SSH
        # round-trips). Fan out with a thread pool so a 25-node lab completes
        # in seconds instead of sequentially waiting on every subprocess.
        max_workers = min(len(nodes), 16) or 1
        with ThreadPoolExecutor(max_workers=max_workers) as pool:
            futures = [pool.submit(_collect_one, node) for node in nodes]
            for fut in as_completed(futures):
                name, outputs, err = fut.result()
                if outputs is not None:
                    driver_outputs[name] = outputs
                if err:
                    errors.append(err)

        ir = build_ir(nodes, driver_outputs, PARSER_REGISTRY, clab_links=clab_links)
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
