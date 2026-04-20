"""Export NetXray-IR to containerlab project (YAML + per-node configs).

Two entry points:
- ``build_clab_yaml(ir)`` — pure IR → YAML text (used by /api/iac/export/clab)
- ``export_to_clab(ir, output_dir)`` — writes YAML + configs/<id>/{frr.conf,daemons,startup-config}
  and returns the .clab.yml path (used by /api/iac/clone-to-clab)
"""

from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Dict

import yaml

# vendor → (clab kind, default image). Image can be overridden via env vars.
VENDOR_CLAB: dict[str, dict[str, str]] = {
    "frr": {
        "kind": "linux",
        "image": os.getenv("NETXRAY_FRR_IMAGE", "quay.io/frrouting/frr:latest"),
    },
    "arista": {
        "kind": "ceos",
        "image": os.getenv("NETXRAY_CEOS_IMAGE", "ceos:4.32.0F"),
    },
    "generic": {
        "kind": "linux",
        "image": os.getenv("NETXRAY_GENERIC_IMAGE", "alpine:latest"),
    },
}

UNSUPPORTED_CLONE_VENDORS = {"cisco_xr", "juniper_junos"}


def _vendor_entry(vendor: str) -> dict[str, str]:
    return VENDOR_CLAB.get(vendor, VENDOR_CLAB["generic"])


def _node_base(node: dict) -> dict[str, Any]:
    vendor = node.get("vendor", "generic")
    entry = _vendor_entry(vendor)
    clab_node: dict[str, Any] = {"kind": entry["kind"]}
    if entry["image"]:
        clab_node["image"] = entry["image"]
    if node.get("hostname"):
        clab_node["hostname"] = node["hostname"]
    return clab_node


def build_clab_yaml(ir: dict) -> str:
    """Build a clab YAML string from an IR, without writing per-node configs."""
    clab = {
        "name": ir.get("metadata", {}).get("name", "netxray-exported"),
        "topology": {"nodes": {}, "links": []},
    }
    for node in ir.get("topology", {}).get("nodes", []):
        clab["topology"]["nodes"][node["id"]] = _node_base(node)

    for link in ir.get("topology", {}).get("links", []):
        src, tgt = link["source"], link["target"]
        clab["topology"]["links"].append({
            "endpoints": [
                f"{src['node']}:{src['interface']}",
                f"{tgt['node']}:{tgt['interface']}",
            ]
        })
    return yaml.dump(clab, sort_keys=False)


def export_to_clab(ir: dict, output_dir: Path) -> Path:
    """Write a deployable clab project under ``output_dir``.

    Layout::
        output_dir/
          <topo>.clab.yml
          configs/
            <node_id>/
              frr.conf            (FRR)
              daemons             (FRR, per detected protocols)
              startup-config      (Arista)

    Returns the path to the YAML file.
    """
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    configs_dir = output_dir / "configs"

    topo_name = ir.get("metadata", {}).get("name", "netxray-exported")
    clab: Dict[str, Any] = {
        "name": topo_name,
        "topology": {"nodes": {}, "links": []},
    }

    for node in ir.get("topology", {}).get("nodes", []):
        node_id = node["id"]
        vendor = node.get("vendor", "generic")
        clab_node = _node_base(node)

        raw_config: str | None = node.get("raw_config")
        binds = _write_node_configs(configs_dir, node_id, vendor, raw_config)
        if binds:
            clab_node["binds"] = binds

        clab["topology"]["nodes"][node_id] = clab_node

    for link in ir.get("topology", {}).get("links", []):
        src, tgt = link["source"], link["target"]
        clab["topology"]["links"].append({
            "endpoints": [
                f"{src['node']}:{src['interface']}",
                f"{tgt['node']}:{tgt['interface']}",
            ]
        })

    yaml_path = output_dir / f"{_safe_filename(topo_name)}.clab.yml"
    yaml_path.write_text(yaml.dump(clab, sort_keys=False), encoding="utf-8")
    return yaml_path


def _write_node_configs(
    configs_dir: Path,
    node_id: str,
    vendor: str,
    raw_config: str | None,
) -> list[str]:
    if not raw_config:
        return []

    node_dir = configs_dir / node_id
    node_dir.mkdir(parents=True, exist_ok=True)
    binds: list[str] = []

    if vendor == "frr":
        (node_dir / "frr.conf").write_text(raw_config, encoding="utf-8")
        (node_dir / "daemons").write_text(_build_frr_daemons(raw_config), encoding="utf-8")
        binds.append(f"configs/{node_id}/frr.conf:/etc/frr/frr.conf")
        binds.append(f"configs/{node_id}/daemons:/etc/frr/daemons")
    elif vendor == "arista":
        (node_dir / "startup-config").write_text(raw_config, encoding="utf-8")
        binds.append(f"configs/{node_id}/startup-config:/mnt/flash/startup-config")
    else:
        # generic / unknown — just stash for reference, don't bind.
        (node_dir / "config.txt").write_text(raw_config, encoding="utf-8")

    return binds


def _build_frr_daemons(raw_config: str) -> str:
    """Emit an /etc/frr/daemons file enabling only the daemons referenced in raw_config."""
    daemons = {
        "bgpd": bool(re.search(r"^router bgp\b", raw_config, re.MULTILINE)),
        "ospfd": bool(re.search(r"^router ospf\b", raw_config, re.MULTILINE)),
        "ospf6d": bool(re.search(r"^router ospf6\b", raw_config, re.MULTILINE)),
        "isisd": bool(re.search(r"^router isis\b", raw_config, re.MULTILINE)),
        "ripd": bool(re.search(r"^router rip\b", raw_config, re.MULTILINE)),
        "pimd": False,
        "ldpd": bool(re.search(r"^mpls ldp\b", raw_config, re.MULTILINE)),
        "staticd": True,   # needed for any `ip route ...` in running-config
    }
    lines = ["# Generated by NetXray clab_exporter", "zebra=yes"]
    for name, enabled in daemons.items():
        lines.append(f"{name}={'yes' if enabled else 'no'}")
    # Default options lines used by upstream FRR daemons file.
    lines.extend([
        "",
        'vtysh_enable=yes',
        'zebra_options="  -A 127.0.0.1 -s 90000000"',
        'bgpd_options="   -A 127.0.0.1"',
        'ospfd_options="  -A 127.0.0.1"',
        'ospf6d_options=" -A ::1"',
        'isisd_options="  -A 127.0.0.1"',
        'ripd_options="   -A 127.0.0.1"',
        'staticd_options="-A 127.0.0.1"',
        "",
    ])
    return "\n".join(lines)


def validate_ir_for_clone(ir: dict) -> list[str]:
    """Return a list of validation error messages (empty if OK)."""
    errors: list[str] = []
    nodes = ir.get("topology", {}).get("nodes", [])
    if not nodes:
        errors.append("IR contains no nodes")

    unsupported: set[str] = set()
    for node in nodes:
        vendor = node.get("vendor", "generic")
        if vendor in UNSUPPORTED_CLONE_VENDORS:
            unsupported.add(vendor)
    if unsupported:
        errors.append(
            f"Vendor(s) not yet supported for clone: {sorted(unsupported)}. "
            "Supported vendors: frr, arista, generic."
        )
    return errors


def _safe_filename(name: str) -> str:
    return "".join(c if c.isalnum() or c in "-_" else "_" for c in name) or "netxray-exported"
