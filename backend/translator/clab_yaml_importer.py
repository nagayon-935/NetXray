"""Static containerlab YAML -> NetXray IR conversion.

Unlike `collector/clab.py::inspect_lab` which requires running containers,
this module derives a best-effort IR purely from the YAML text (plus any
startup-config files referenced under `binds:` that happen to be readable
from disk). No mgmt IP, no live interface state — just topology shape.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml

from collector.clab import _detect_vendor
from translator.parsers import PARSER_REGISTRY

logger = logging.getLogger(__name__)


def _node_type(vendor: str) -> str:
    if vendor in ("frr", "arista", "cisco_xr", "juniper_junos"):
        return "router"
    return "host"


def _find_startup_config(
    node_cfg: dict[str, Any],
    base_dir: Path | None,
) -> str | None:
    """Look for a startup-config or bind-mounted config file on disk.

    Returns the file content, or None if nothing readable is found.
    """
    candidates: list[str] = []

    sc = node_cfg.get("startup-config") or node_cfg.get("startup_config")
    if isinstance(sc, str):
        candidates.append(sc)

    for bind in node_cfg.get("binds", []) or []:
        if not isinstance(bind, str):
            continue
        # containerlab bind format: "local:remote[:mode]"
        local = bind.split(":", 1)[0]
        if local.endswith(("frr.conf", "startup-config", "daemons.conf")):
            candidates.append(local)

    for cand in candidates:
        path = Path(cand)
        if not path.is_absolute() and base_dir is not None:
            path = base_dir / path
        try:
            if path.exists() and path.is_file():
                return path.read_text()
        except OSError as exc:
            logger.debug("Cannot read startup config %s: %s", path, exc)
    return None


def import_from_yaml(
    yaml_text: str,
    base_dir: Path | None = None,
) -> dict[str, Any]:
    """Parse a containerlab YAML string and return a NetXray-IR dict.

    base_dir: directory used to resolve relative paths under `binds:` /
              `startup-config:`. If None, relative paths are skipped.
    """
    try:
        doc = yaml.safe_load(yaml_text) or {}
    except yaml.YAMLError as exc:
        raise ValueError(f"Invalid YAML: {exc}") from exc

    topology = doc.get("topology") or {}
    nodes_cfg: dict[str, dict[str, Any]] = topology.get("nodes") or {}
    links_cfg: list[dict[str, Any]] = topology.get("links") or []
    defaults = topology.get("defaults") or {}
    kinds_cfg = topology.get("kinds") or {}

    # ── Collect per-node interface names from links (endpoint[n]: "node:iface")
    node_ifaces: dict[str, set[str]] = {name: set() for name in nodes_cfg}
    ir_links: list[dict[str, Any]] = []

    for idx, link in enumerate(links_cfg):
        endpoints = link.get("endpoints")
        if not endpoints or len(endpoints) != 2:
            continue
        try:
            src_node, src_if = endpoints[0].split(":", 1)
            dst_node, dst_if = endpoints[1].split(":", 1)
        except (AttributeError, ValueError):
            continue
        node_ifaces.setdefault(src_node, set()).add(src_if)
        node_ifaces.setdefault(dst_node, set()).add(dst_if)
        ir_links.append(
            {
                "id": f"link-{idx}-{src_node}-{src_if}-{dst_node}-{dst_if}",
                "source": {"node": src_node, "interface": src_if},
                "target": {"node": dst_node, "interface": dst_if},
                "state": "up",
            }
        )

    # ── Build IR nodes
    ir_nodes: list[dict[str, Any]] = []
    for name, cfg in nodes_cfg.items():
        cfg = cfg or {}
        kind = (
            cfg.get("kind")
            or defaults.get("kind")
            or ""
        )
        image = (
            cfg.get("image")
            or (kinds_cfg.get(kind, {}) or {}).get("image")
            or defaults.get("image")
            or ""
        )
        vendor = _detect_vendor(image, kind)

        ifaces_ir: dict[str, dict[str, Any]] = {}
        for iface_name in sorted(node_ifaces.get(name, set())):
            ifaces_ir[iface_name] = {"state": "up"}

        node_entry: dict[str, Any] = {
            "id": name,
            "type": _node_type(vendor),
            "vendor": vendor if vendor in ("frr", "arista", "generic") else "generic",
            "hostname": name,
            "interfaces": ifaces_ir,
            "vrfs": {"default": {"routing_table": []}},
        }

        raw_config = _find_startup_config(cfg, base_dir)
        if raw_config:
            node_entry["raw_config"] = raw_config
            parser_cls = PARSER_REGISTRY.get(vendor)
            if parser_cls is not None:
                parser = parser_cls()
                outputs = {"show running-config": raw_config}
                if hasattr(parser, "parse_bgp"):
                    try:
                        bgp = parser.parse_bgp(outputs)
                        if bgp:
                            node_entry["bgp"] = bgp
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("parse_bgp failed for %s: %s", name, exc)
                if hasattr(parser, "parse_ospf"):
                    try:
                        ospf = parser.parse_ospf(outputs)
                        if ospf:
                            node_entry["ospf"] = ospf
                    except Exception as exc:  # noqa: BLE001
                        logger.warning("parse_ospf failed for %s: %s", name, exc)

        ir_nodes.append(node_entry)

    return {
        "ir_version": "0.2.0",
        "topology": {
            "nodes": ir_nodes,
            "links": ir_links,
        },
        "policies": {"acls": {}},
    }


def import_from_path(yaml_path: str | os.PathLike[str]) -> dict[str, Any]:
    path = Path(yaml_path)
    return import_from_yaml(path.read_text(), base_dir=path.parent)
