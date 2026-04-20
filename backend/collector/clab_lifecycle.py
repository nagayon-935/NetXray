"""Run containerlab lifecycle commands as async subprocesses with log streaming."""

from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any, Awaitable, Callable

logger = logging.getLogger(__name__)

# Ring buffer for log re-attachment (late WS joiners)
_RUN_LOGS: dict[str, list[str]] = {}
_MAX_RUNS = 20

# At most one lifecycle op runs at a time
_active_task: asyncio.Task | None = None
_active_run_id: str | None = None

BroadcastFn = Callable[[str, dict[str, Any]], Awaitable[None]]


def is_running() -> bool:
    return _active_task is not None and not _active_task.done()


def active_run_id() -> str | None:
    return _active_run_id if is_running() else None


async def start_lifecycle(
    action: str,
    topology_file: str,
    extra_args: list[str],
    broadcast: BroadcastFn,
) -> str:
    """
    Launch *action* (deploy | destroy | redeploy) non-blocking.
    Returns the run_id immediately; progress arrives via *broadcast*.
    Raises RuntimeError if another lifecycle op is already in progress.
    """
    global _active_task, _active_run_id

    if is_running():
        raise RuntimeError(f"Lifecycle op already in progress (run_id={_active_run_id})")

    run_id = uuid.uuid4().hex[:8]
    _active_run_id = run_id

    # Trim ring buffer
    if len(_RUN_LOGS) >= _MAX_RUNS:
        oldest = next(iter(_RUN_LOGS))
        del _RUN_LOGS[oldest]
    _RUN_LOGS[run_id] = []

    cmd = ["containerlab", action, "-t", topology_file, *extra_args]
    _active_task = asyncio.create_task(
        _run(run_id, cmd, broadcast),
        name=f"clab:{action}:{run_id}",
    )
    return run_id


async def _run(run_id: str, cmd: list[str], broadcast: BroadcastFn) -> None:
    try:
        # Infer working directory from topology file (-t flag)
        cwd = None
        try:
            t_idx = cmd.index("-t")
            topo_path = cmd[t_idx + 1]
            import os
            if os.path.isabs(topo_path):
                cwd = os.path.dirname(topo_path)
        except (ValueError, IndexError):
            pass

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            cwd=cwd,
        )

        assert proc.stdout is not None
        async for raw in proc.stdout:
            line = raw.decode(errors="replace").rstrip()
            _RUN_LOGS[run_id].append(line)
            await broadcast(run_id, {"type": "log", "line": line})

        code = await proc.wait()
        _RUN_LOGS[run_id].append(f"[exit {code}]")
        await broadcast(run_id, {"type": "exit", "code": code})
        logger.info("lifecycle run_id=%s exit=%d", run_id, code)

    except asyncio.CancelledError:
        await broadcast(run_id, {"type": "error", "message": "cancelled"})
    except Exception as exc:
        logger.error("lifecycle error run_id=%s: %s", run_id, exc)
        await broadcast(run_id, {"type": "error", "message": str(exc)})


def get_run_logs(run_id: str) -> list[str]:
    """Return buffered log lines for a recent run (for late WS joiners)."""
    return list(_RUN_LOGS.get(run_id, []))
