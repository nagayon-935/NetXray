"""containerlab tools netem wrapper for link impairment controls."""

import logging
import subprocess
from dataclasses import asdict, dataclass

logger = logging.getLogger(__name__)


@dataclass
class ImpairmentSpec:
    node: str
    interface: str
    delay_ms: int | None = None
    jitter_ms: int | None = None
    loss_pct: float | None = None
    rate_kbit: int | None = None
    corruption_pct: float | None = None


# In-memory registry of active impairments; keyed by (node, interface).
# Cleared on backend restart (impairments are not persisted — netem state
# resets on lab redeploy anyway).
_ACTIVE: dict[tuple[str, str], ImpairmentSpec] = {}


def set_impairment(spec: ImpairmentSpec) -> None:
    """Apply tc-netem impairment on a single node interface."""
    cmd = [
        "containerlab", "tools", "netem", "set",
        "-n", spec.node,
        "-i", spec.interface,
    ]
    if spec.delay_ms is not None:
        cmd += ["--delay", f"{spec.delay_ms}ms"]
    if spec.jitter_ms is not None:
        cmd += ["--jitter", f"{spec.jitter_ms}ms"]
    if spec.loss_pct is not None:
        cmd += ["--loss", str(spec.loss_pct)]
    if spec.rate_kbit is not None:
        cmd += ["--rate", str(spec.rate_kbit)]
    if spec.corruption_pct is not None:
        cmd += ["--corruption", str(spec.corruption_pct)]

    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"netem set failed (code {result.returncode})")

    _ACTIVE[(spec.node, spec.interface)] = spec
    logger.info("netem set: node=%s iface=%s", spec.node, spec.interface)


def clear_impairment(node: str, interface: str) -> None:
    """Remove tc-netem impairment from a single node interface."""
    cmd = [
        "containerlab", "tools", "netem", "reset",
        "-n", node,
        "-i", interface,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or f"netem reset failed (code {result.returncode})")

    _ACTIVE.pop((node, interface), None)
    logger.info("netem reset: node=%s iface=%s", node, interface)


def get_impairment(node: str, interface: str) -> ImpairmentSpec | None:
    return _ACTIVE.get((node, interface))


def list_impairments() -> list[dict]:
    return [asdict(v) for v in _ACTIVE.values()]


def clear_all() -> None:
    """Clear all tracked impairments (called on lab destroy)."""
    keys = list(_ACTIVE.keys())
    for node, iface in keys:
        try:
            clear_impairment(node, iface)
        except Exception as exc:
            logger.warning("Failed to clear netem for %s/%s: %s", node, iface, exc)
