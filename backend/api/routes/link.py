"""Link impairment API — wraps containerlab tools netem."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from collector.clab_netem import (
    ImpairmentSpec,
    clear_impairment,
    list_impairments,
    set_impairment,
)

router = APIRouter(prefix="/link", tags=["link"])


class ImpairmentRequest(BaseModel):
    source_node: str
    source_interface: str
    target_node: str
    target_interface: str
    delay_ms: int | None = Field(default=None, ge=0)
    jitter_ms: int | None = Field(default=None, ge=0)
    loss_pct: float | None = Field(default=None, ge=0, le=100)
    rate_kbit: int | None = Field(default=None, ge=0)
    corruption_pct: float | None = Field(default=None, ge=0, le=100)
    both_directions: bool = True


class ClearRequest(BaseModel):
    source_node: str
    source_interface: str
    target_node: str
    target_interface: str
    both_directions: bool = True


def _apply(node: str, iface: str, req: ImpairmentRequest) -> None:
    spec = ImpairmentSpec(
        node=node,
        interface=iface,
        delay_ms=req.delay_ms,
        jitter_ms=req.jitter_ms,
        loss_pct=req.loss_pct,
        rate_kbit=req.rate_kbit,
        corruption_pct=req.corruption_pct,
    )
    set_impairment(spec)


@router.post("/impairment")
async def set_link_impairment(req: ImpairmentRequest) -> dict:
    """Apply tc-netem impairment on one or both sides of a link."""
    errors: list[str] = []
    try:
        _apply(req.source_node, req.source_interface, req)
    except RuntimeError as exc:
        errors.append(f"{req.source_node}/{req.source_interface}: {exc}")

    if req.both_directions:
        try:
            _apply(req.target_node, req.target_interface, req)
        except RuntimeError as exc:
            errors.append(f"{req.target_node}/{req.target_interface}: {exc}")

    if errors:
        raise HTTPException(status_code=500, detail="; ".join(errors))

    return {"ok": True}


@router.delete("/impairment")
async def clear_link_impairment(req: ClearRequest) -> dict:
    """Remove tc-netem impairment from one or both sides of a link."""
    errors: list[str] = []
    for node, iface in [
        (req.source_node, req.source_interface),
        *([(req.target_node, req.target_interface)] if req.both_directions else []),
    ]:
        try:
            clear_impairment(node, iface)
        except RuntimeError as exc:
            errors.append(f"{node}/{iface}: {exc}")

    if errors:
        raise HTTPException(status_code=500, detail="; ".join(errors))

    return {"ok": True}


@router.get("/impairments")
async def get_impairments() -> dict:
    """List all currently active link impairments."""
    return {"impairments": list_impairments()}
