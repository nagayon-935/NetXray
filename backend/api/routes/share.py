import re
import uuid
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from api.config import settings

router = APIRouter(prefix="/share", tags=["share"])

# Share state is stored in a single JSON file inside data_dir.
# For a local lab tool this is sufficient; swap for Redis / a DB for multi-user.
SHARE_DB_PATH: Path = settings.data_dir / "shares.json"

# 8-char hex share ID — only characters from a UUID hex string
_SHARE_ID_RE = re.compile(r"^[0-9a-f]{8}$")


class ShareRequest(BaseModel):
    state: str  # gzip-compressed, base64url-encoded payload from share.ts


class ShareResponse(BaseModel):
    id: str


# ─── Storage helpers ─────────────────────────────────────────────────────────

def _load_db() -> dict[str, str]:
    if not SHARE_DB_PATH.exists():
        return {}
    try:
        return json.loads(SHARE_DB_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return {}


def _save_db(db: dict[str, str]) -> None:
    SHARE_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    SHARE_DB_PATH.write_text(json.dumps(db))


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.post("", response_model=ShareResponse)
async def create_share(req: ShareRequest) -> ShareResponse:
    """
    Persist an encoded share payload and return a short 8-character ID.
    The client can later reconstruct the full share URL as
    ``<origin>/#share=<payload>`` (hash-based, no server round-trip needed),
    or use this ID to retrieve the payload via GET /api/share/{id}.
    """
    if not req.state:
        raise HTTPException(status_code=400, detail="Share state must not be empty")

    # Prevent abuse: cap payload size at 2 MB (uncompressed base64)
    if len(req.state) > 2 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Share payload too large (max 2 MB)")

    share_id = str(uuid.uuid4()).replace("-", "")[:8]
    db = _load_db()
    db[share_id] = req.state
    _save_db(db)
    return ShareResponse(id=share_id)


@router.get("/{share_id}")
async def get_share(share_id: str) -> dict[str, str]:
    """Retrieve a previously stored share payload by its 8-character ID."""
    if not _SHARE_ID_RE.match(share_id):
        raise HTTPException(status_code=400, detail="Invalid share ID format")

    db = _load_db()
    state = db.get(share_id)
    if state is None:
        raise HTTPException(status_code=404, detail=f"Share '{share_id}' not found")
    return {"state": state}
