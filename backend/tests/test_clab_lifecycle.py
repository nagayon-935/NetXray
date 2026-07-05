import asyncio
import pytest

from collector import clab_lifecycle


async def _fake_events(lab_name):
    yield ("leaf1", "running")
    yield ("leaf2", "running")
    await asyncio.sleep(3600)  # simulate a long-lived docker events stream


async def _noop_broadcast(run_id, payload):
    pass


async def _stop_and_wait(lab_name):
    task = clab_lifecycle._WATCH_TASKS.get(lab_name)
    clab_lifecycle.stop_node_watch(lab_name)
    if task is not None:
        try:
            await task
        except asyncio.CancelledError:
            pass


@pytest.mark.asyncio
async def test_start_node_watch_broadcasts_events(monkeypatch):
    monkeypatch.setattr(clab_lifecycle, "stream_docker_events", _fake_events)

    received: list[tuple[str, dict]] = []

    async def broadcast(run_id, payload):
        received.append((run_id, payload))

    clab_lifecycle.start_node_watch("run-1", "mylab", broadcast)
    await asyncio.sleep(0.05)  # let the background task run one iteration

    assert ("run-1", {"type": "node_state", "node_id": "leaf1", "state": "running"}) in received
    assert ("run-1", {"type": "node_state", "node_id": "leaf2", "state": "running"}) in received

    await _stop_and_wait("mylab")


@pytest.mark.asyncio
async def test_start_node_watch_replaces_existing_task_for_same_lab(monkeypatch):
    monkeypatch.setattr(clab_lifecycle, "stream_docker_events", _fake_events)

    clab_lifecycle.start_node_watch("run-1", "mylab", _noop_broadcast)
    first_task = clab_lifecycle._WATCH_TASKS["mylab"]

    clab_lifecycle.start_node_watch("run-2", "mylab", _noop_broadcast)
    second_task = clab_lifecycle._WATCH_TASKS["mylab"]

    assert first_task is not second_task
    await asyncio.sleep(0)
    assert first_task.cancelled() or first_task.done()

    await _stop_and_wait("mylab")


@pytest.mark.asyncio
async def test_stop_node_watch_cancels_and_clears(monkeypatch):
    monkeypatch.setattr(clab_lifecycle, "stream_docker_events", _fake_events)

    clab_lifecycle.start_node_watch("run-1", "mylab", _noop_broadcast)
    await _stop_and_wait("mylab")

    assert "mylab" not in clab_lifecycle._WATCH_TASKS
