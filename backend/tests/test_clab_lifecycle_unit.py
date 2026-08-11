"""Unit tests for collector/clab_lifecycle.py."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from collector import clab_lifecycle


def teardown_module():
    """Ensure global state is clean after this module."""
    for lab_name in list(clab_lifecycle._WATCH_TASKS.keys()):
        clab_lifecycle.stop_node_watch(lab_name)
    clab_lifecycle._RUN_LOGS.clear()
    clab_lifecycle._active_task = None
    clab_lifecycle._active_run_id = None


@pytest.fixture(autouse=True)
def reset_state():
    """Reset global lifecycle state before each test."""
    for lab_name in list(clab_lifecycle._WATCH_TASKS.keys()):
        clab_lifecycle.stop_node_watch(lab_name)
    clab_lifecycle._RUN_LOGS.clear()
    clab_lifecycle._active_task = None
    clab_lifecycle._active_run_id = None
    yield
    for lab_name in list(clab_lifecycle._WATCH_TASKS.keys()):
        clab_lifecycle.stop_node_watch(lab_name)
    clab_lifecycle._RUN_LOGS.clear()
    clab_lifecycle._active_task = None
    clab_lifecycle._active_run_id = None


@pytest.mark.asyncio
async def test_is_running_and_active_run_id():
    assert clab_lifecycle.is_running() is False
    assert clab_lifecycle.active_run_id() is None

    clab_lifecycle._active_run_id = "run-1"
    clab_lifecycle._active_task = MagicMock()
    clab_lifecycle._active_task.done.return_value = False
    assert clab_lifecycle.is_running() is True
    assert clab_lifecycle.active_run_id() == "run-1"


def test_get_run_logs():
    clab_lifecycle._RUN_LOGS["run-x"] = ["a", "b"]
    assert clab_lifecycle.get_run_logs("run-x") == ["a", "b"]
    assert clab_lifecycle.get_run_logs("missing") == []


@pytest.mark.asyncio
async def test_start_lifecycle_stores_logs_and_broadcasts(monkeypatch):
    import asyncio

    class FakeProc:
        returncode = 0
        stdout = asyncio.StreamReader()

        async def wait(self):
            return 0

    fake_proc = FakeProc()
    fake_proc.stdout.feed_data(b"line1\n")
    fake_proc.stdout.feed_data(b"line2\n")
    fake_proc.stdout.feed_eof()

    async def fake_create(*args, **kwargs):
        return fake_proc

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    received = []

    async def broadcast(run_id, payload):
        received.append((run_id, payload))

    run_id = await clab_lifecycle.start_lifecycle("deploy", "/tmp/lab.clab.yml", [], broadcast)
    assert run_id is not None

    # Wait for task to complete
    if clab_lifecycle._active_task:
        try:
            await clab_lifecycle._active_task
        except Exception:
            pass

    assert (run_id, {"type": "log", "line": "line1"}) in received
    assert (run_id, {"type": "log", "line": "line2"}) in received
    assert clab_lifecycle.get_run_logs(run_id) == ["line1", "line2", "[exit 0]"]


@pytest.mark.asyncio
async def test_start_lifecycle_busy():
    clab_lifecycle._active_run_id = "run-busy"
    clab_lifecycle._active_task = MagicMock()
    clab_lifecycle._active_task.done.return_value = False

    with pytest.raises(RuntimeError, match="already in progress"):
        await clab_lifecycle.start_lifecycle("deploy", "/tmp/lab.clab.yml", [], AsyncMock())


@pytest.mark.asyncio
async def test_start_lifecycle_cwd_inferred(monkeypatch):
    import asyncio

    class FakeProc:
        returncode = 0
        stdout = asyncio.StreamReader()
        stdout.feed_eof()

        async def wait(self):
            return 0

    async def fake_create(*args, **kwargs):
        FakeProc._kwargs = kwargs
        return FakeProc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    await clab_lifecycle.start_lifecycle("deploy", "/tmp/lab.clab.yml", [], AsyncMock())
    if clab_lifecycle._active_task:
        try:
            await clab_lifecycle._active_task
        except Exception:
            pass

    assert FakeProc._kwargs.get("cwd") == "/tmp"


@pytest.mark.asyncio
async def test_run_exception_broadcasts_error(monkeypatch):
    import asyncio

    async def fake_create(*args, **kwargs):
        raise RuntimeError("spawn failed")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    received = []

    async def broadcast(run_id, payload):
        received.append(payload)

    run_id = await clab_lifecycle.start_lifecycle("deploy", "/tmp/lab.clab.yml", [], broadcast)
    if clab_lifecycle._active_task:
        try:
            await clab_lifecycle._active_task
        except Exception:
            pass

    assert any(p.get("type") == "error" for p in received)


@pytest.mark.asyncio
async def test_run_cancelled_broadcasts_error(monkeypatch):
    import asyncio

    class FakeProc:
        returncode = None
        stdout = asyncio.StreamReader()
        stdout.feed_eof()

        async def wait(self):
            raise asyncio.CancelledError()

    async def fake_create(*args, **kwargs):
        return FakeProc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    received = []

    async def broadcast(run_id, payload):
        received.append(payload)

    await clab_lifecycle._run("run-cancel", ["containerlab", "deploy", "-t", "/tmp/lab.clab.yml"], broadcast)

    assert any(p.get("type") == "error" and p.get("message") == "cancelled" for p in received)


@pytest.mark.asyncio
async def test_run_log_ring_buffer_trim(monkeypatch):
    import asyncio

    class FakeProc:
        returncode = 0
        stdout = asyncio.StreamReader()
        stdout.feed_eof()

        async def wait(self):
            return 0

    async def fake_create(*args, **kwargs):
        return FakeProc()

    monkeypatch.setattr(asyncio, "create_subprocess_exec", fake_create)

    for i in range(clab_lifecycle._MAX_RUNS + 2):
        rid = await clab_lifecycle.start_lifecycle("deploy", "/tmp/lab.clab.yml", [], AsyncMock())
        if clab_lifecycle._active_task:
            try:
                await clab_lifecycle._active_task
            except Exception:
                pass

    assert len(clab_lifecycle._RUN_LOGS) <= clab_lifecycle._MAX_RUNS


@pytest.mark.asyncio
async def test_start_node_watch_creates_task(monkeypatch):
    async def fake_events(lab_name):
        yield ("leaf1", "running")

    monkeypatch.setattr(clab_lifecycle, "stream_docker_events", fake_events)

    received = []

    async def broadcast(run_id, payload):
        received.append(payload)

    clab_lifecycle.start_node_watch("run-1", "mylab", broadcast)
    await asyncio.sleep(0.05)
    clab_lifecycle.stop_node_watch("mylab")

    assert any(p == {"type": "node_state", "node_id": "leaf1", "state": "running"} for p in received)


@pytest.mark.asyncio
async def test_start_node_watch_replaces_existing(monkeypatch):
    async def fake_events(lab_name):
        await asyncio.sleep(3600)

    monkeypatch.setattr(clab_lifecycle, "stream_docker_events", fake_events)

    clab_lifecycle.start_node_watch("run-1", "mylab", AsyncMock())
    first = clab_lifecycle._WATCH_TASKS["mylab"]
    clab_lifecycle.start_node_watch("run-2", "mylab", AsyncMock())
    second = clab_lifecycle._WATCH_TASKS["mylab"]

    assert first is not second
    clab_lifecycle.stop_node_watch("mylab")


@pytest.mark.asyncio
async def test_stop_node_watch_cleans_up(monkeypatch):
    async def fake_events(lab_name):
        await asyncio.sleep(3600)

    monkeypatch.setattr(clab_lifecycle, "stream_docker_events", fake_events)

    clab_lifecycle.start_node_watch("run-1", "mylab", AsyncMock())
    clab_lifecycle.stop_node_watch("mylab")

    await asyncio.sleep(0)
    assert "mylab" not in clab_lifecycle._WATCH_TASKS
