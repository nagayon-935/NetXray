"""
Global in-memory IR state.

Holds the most recently loaded topology IR so other subsystems
(e.g. /metrics) can derive live data from it without going to disk.

NOTE: This module-level global is only valid when running with a **single worker**
process. In multi-worker setups (Gunicorn / ``uvicorn --workers N``) each worker
has its own copy of this state and may return stale or absent data.  Replace with
a shared backend (Redis, database) before scaling beyond one worker.
"""
from typing import Any, Dict, Optional

_current_ir: Optional[Dict[str, Any]] = None


def set_current_ir(ir: Dict[str, Any]) -> None:
    global _current_ir
    _current_ir = ir


def get_current_ir() -> Optional[Dict[str, Any]]:
    return _current_ir
