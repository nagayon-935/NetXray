import uuid
import json
from pathlib import Path
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.api.config import settings

router = APIRouter(prefix="/share", tags=["share"])

# Simplified storage using a JSON file in data_dir
SHARE_DB_PATH = settings.data_dir / "shares.json"

class ShareRequest(BaseModel):
    state: str  # Compressed base64 string

class ShareResponse(BaseModel):
    id: string

def load_db():
    if not SHARE_DB_PATH.exists():
        return {}
    with open(SHARE_DB_PATH, "r") as f:
        return json.load(f)

def save_db(db):
    with open(SHARE_DB_PATH, "w") as f:
        json.dump(db, f)

@router.post("")
async def create_share(req: ShareRequest):
    share_id = str(uuid.uuid4())[:8]
    db = load_db()
    db[share_id] = req.state
    save_db(db)
    return {"id": share_id}

@router.get("/{share_id}")
async def get_share(share_id: str):
    db = load_db()
    state = db.get(share_id)
    if not state:
        raise HTTPException(status_code=404, detail="Share not found")
    return {"state": state}
