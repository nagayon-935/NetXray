# NetXray UX & Cleanup Fixes Implementation Plan

> **Status (2026-07-05):** Tasks 1-6 implemented and committed (`0433861`, `65418ca`, `1f69bd7`, `19a6c7d`). Task 6 shipped narrower than originally drafted — the drafted `PanelTabBar.tsx` component was found to duplicate an existing "Panel:" button group in `SimToolbar.tsx` and was removed; only the underlying `topology-store.ts` selection/activePanel decoupling fix (the actual bug) was kept. All backend tests pass (65/65); frontend build and manual browser verification passed.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the concrete problems identified during codebase review: dead backend dependencies/stubs, unwired containerlab node-state telemetry, poor containerlab lab-selection UX, and the confusing single-panel/pane-click UI model.

**Architecture:** Backend changes extend the existing `clab_lifecycle.py` background-task pattern (already used for lifecycle log streaming) to also broadcast docker container state over the same per-run WebSocket channel. Frontend changes extend `useLabControl.ts`'s existing message handler and add an explicit tab bar to `TopologyCanvas.tsx` so panel navigation is deliberate instead of an accidental side effect of canvas clicks.

**Tech Stack:** FastAPI + asyncio (backend), React + Zustand + `@xyflow/react` (frontend), pytest + pytest-asyncio (backend tests). Frontend has no test suite (per project convention) — frontend tasks are verified manually via the dev server.

## Global Constraints

- Follow existing code style: no comments unless explaining non-obvious WHY, PEP 8 + type hints on Python, explicit prop types on TSX (no `any`).
- No new dependencies. All work uses libraries already in `backend/pyproject.toml` / `frontend/package.json`.
- Every backend task must pass `uv run pytest` before committing.
- Commit messages: `<type>: <description>` (feat/fix/refactor/chore), no attribution trailer.
- Correction from prior review: Cisco XR / Juniper Junos plugin directories were earlier assumed to have working `driver.py`/`parser.py` implementations that just weren't registered. Verified false — `backend/plugins/cisco_xr/` and `backend/plugins/juniper_junos/` contain only `__init__.py` with a `VendorPlugin` subclass whose `driver`, `parser`, `config_generator` are all `None`. There is nothing real to wire up; Task 1.2 removes these empty stubs instead.

---

## Task 1: Dead dependency and stub cleanup

**Files:**
- Modify: `backend/pyproject.toml`
- Delete: `backend/collector/gnmi_client.py`
- Delete: `backend/plugins/cisco_xr/` (directory)
- Delete: `backend/plugins/juniper_junos/` (directory)
- Test: `backend/tests/test_api.py` (existing — run full suite to confirm nothing depended on the removed files)

**Interfaces:**
- Consumes: nothing (pure removal)
- Produces: nothing new. Confirms `backend/collector/drivers/__init__.py::DRIVER_REGISTRY` and `backend/translator/parsers/__init__.py::PARSER_REGISTRY` remain unchanged (they never referenced cisco_xr/juniper_junos — confirmed by prior grep).

- [ ] **Step 1: Confirm nothing imports the files being removed**

Run: `grep -rn "gnmi\|GnmiClient\|anthropic\|hcl2\|cisco_xr\|juniper_junos" backend --include="*.py" | grep -v __pycache__ | grep -v "backend/collector/gnmi_client.py\|backend/plugins/cisco_xr\|backend/plugins/juniper_junos"`

Expected: no output (already verified during planning — this step re-confirms before deleting).

- [ ] **Step 2: Remove the three unused dependencies**

In `backend/pyproject.toml`, remove these three lines from the `dependencies` list:
```toml
    "anthropic>=0.18.1",
    "pygnmi>=0.8.12",
    "python-hcl2>=4.3.5",
```

- [ ] **Step 3: Delete the dead files/directories**

Run:
```bash
rm backend/collector/gnmi_client.py
rm -rf backend/plugins/cisco_xr backend/plugins/juniper_junos
```

- [ ] **Step 4: Re-lock and re-sync dependencies**

Run: `cd backend && uv sync`
Expected: lockfile updates, no errors, `anthropic`/`pygnmi`/`python-hcl2` no longer installed.

- [ ] **Step 5: Run the full backend test suite**

Run: `cd backend && uv run pytest`
Expected: all tests pass (same pass count as before this task — no test referenced the removed modules).

- [ ] **Step 6: Commit**

```bash
cd /Users/ryu/dev/projects/netxray
git add backend/pyproject.toml backend/uv.lock
git rm backend/collector/gnmi_client.py
git rm -r backend/plugins/cisco_xr backend/plugins/juniper_junos
git commit -m "chore: remove unused deps and empty vendor plugin stubs

anthropic/pygnmi/python-hcl2 backed features (LLM diagnosis, gNMI telemetry,
Terraform export) were removed in earlier refactors but the dependencies and
a gnmi_client.py stub were left behind. cisco_xr/juniper_junos plugin dirs
only ever contained an empty VendorPlugin subclass (driver/parser/config_generator
all None) — nothing to register."
```

---

## Task 2: Broadcast containerlab node runtime state over the existing lab WebSocket

**Files:**
- Modify: `backend/collector/clab_lifecycle.py`
- Modify: `backend/api/routes/lab.py`
- Modify: `backend/api/routes/iac.py`
- Test: `backend/tests/test_clab_lifecycle.py` (new)

**Interfaces:**
- Consumes: `collector.clab.stream_docker_events(lab_name: str) -> AsyncGenerator[tuple[str, str], None]` (existing, already implemented, yields `(node_id, "running"|"stopped")`).
- Produces: `start_node_watch(run_id: str, lab_name: str, broadcast: BroadcastFn) -> None` and `stop_node_watch(lab_name: str) -> None` in `clab_lifecycle.py`. Broadcasts `{"type": "node_state", "node_id": str, "state": "running"|"stopped"}` over the same `run_id` WS channel used for logs.

- [ ] **Step 1: Write the failing test for start/stop node watch**

Create `backend/tests/test_clab_lifecycle.py`:
```python
import asyncio
import pytest

from collector import clab_lifecycle


async def _fake_events(lab_name):
    yield ("leaf1", "running")
    yield ("leaf2", "running")
    await asyncio.sleep(3600)  # simulate a long-lived docker events stream


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

    clab_lifecycle.stop_node_watch("mylab")


@pytest.mark.asyncio
async def test_start_node_watch_replaces_existing_task_for_same_lab():
    async def broadcast(run_id, payload):
        pass

    clab_lifecycle.start_node_watch("run-1", "mylab", broadcast)
    first_task = clab_lifecycle._WATCH_TASKS["mylab"]

    clab_lifecycle.start_node_watch("run-2", "mylab", broadcast)
    second_task = clab_lifecycle._WATCH_TASKS["mylab"]

    assert first_task is not second_task
    assert first_task.cancelled() or first_task.done()

    clab_lifecycle.stop_node_watch("mylab")


@pytest.mark.asyncio
async def test_stop_node_watch_cancels_and_clears():
    async def broadcast(run_id, payload):
        pass

    clab_lifecycle.start_node_watch("run-1", "mylab", broadcast)
    clab_lifecycle.stop_node_watch("mylab")

    assert "mylab" not in clab_lifecycle._WATCH_TASKS
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_clab_lifecycle.py -v`
Expected: FAIL with `AttributeError: module 'collector.clab_lifecycle' has no attribute 'start_node_watch'`

- [ ] **Step 3: Implement `start_node_watch` / `stop_node_watch`**

In `backend/collector/clab_lifecycle.py`, add after the existing `_active_task`/`_active_run_id` module state (near line 18):

```python
from collector.clab import stream_docker_events

# lab_name → background docker-events watch task (at most one per lab)
_WATCH_TASKS: dict[str, asyncio.Task] = {}


def start_node_watch(run_id: str, lab_name: str, broadcast: BroadcastFn) -> None:
    """Start (or restart) a background task broadcasting node run/stop state for *lab_name*."""
    stop_node_watch(lab_name)
    _WATCH_TASKS[lab_name] = asyncio.create_task(
        _watch_nodes(run_id, lab_name, broadcast),
        name=f"clab:watch:{lab_name}",
    )


def stop_node_watch(lab_name: str) -> None:
    """Cancel the background node-watch task for *lab_name*, if any."""
    task = _WATCH_TASKS.pop(lab_name, None)
    if task is not None and not task.done():
        task.cancel()


async def _watch_nodes(run_id: str, lab_name: str, broadcast: BroadcastFn) -> None:
    try:
        async for node_id, state in stream_docker_events(lab_name):
            await broadcast(run_id, {"type": "node_state", "node_id": node_id, "state": state})
    except asyncio.CancelledError:
        pass
    except Exception as exc:
        logger.error("node watch error lab=%s: %s", lab_name, exc)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_clab_lifecycle.py -v`
Expected: PASS (3 tests)

- [ ] **Step 5: Wire node-watch into the lab lifecycle routes**

In `backend/api/routes/lab.py`, add a YAML-based lab-name resolver and call `start_node_watch`/`stop_node_watch`:

```python
import yaml

from collector.clab_lifecycle import (
    active_run_id,
    get_run_logs,
    is_running,
    start_lifecycle,
    start_node_watch,
    stop_node_watch,
)


def _lab_name_from_topo(topology_file: str) -> str:
    try:
        with open(topology_file) as f:
            data = yaml.safe_load(f) or {}
        name = data.get("name")
        if name:
            return str(name)
    except (OSError, yaml.YAMLError):
        pass
    from pathlib import Path
    stem = Path(topology_file).name
    for ext in (".clab.yml", ".clab.yaml"):
        if stem.endswith(ext):
            return stem[: -len(ext)]
    return Path(topology_file).stem
```

Modify `deploy()` (after `run_id = await start_lifecycle(...)`, before `return`):
```python
    start_node_watch(run_id, _lab_name_from_topo(topo), _broadcast)
```

Modify `destroy()` (after `run_id = await start_lifecycle(...)`, before `return`):
```python
    stop_node_watch(_lab_name_from_topo(topo))
```

Modify `redeploy()` (after `run_id = await start_lifecycle(...)`, before `return`):
```python
    start_node_watch(run_id, _lab_name_from_topo(topo), _broadcast)
```

- [ ] **Step 6: Wire node-watch into clone-to-clab**

In `backend/api/routes/iac.py`, in `clone_to_clab()`, after `run_id = await start_lifecycle("deploy", str(yaml_path), [], _broadcast)`, add:
```python
    from collector.clab_lifecycle import start_node_watch
    start_node_watch(run_id, safe_name, _broadcast)
```

- [ ] **Step 7: Run the full backend test suite**

Run: `cd backend && uv run pytest`
Expected: all tests pass, including the 3 new ones.

- [ ] **Step 8: Commit**

```bash
git add backend/collector/clab_lifecycle.py backend/api/routes/lab.py backend/api/routes/iac.py backend/tests/test_clab_lifecycle.py
git commit -m "feat: broadcast containerlab node run/stop state over lab WS channel

stream_docker_events() existed but was never called from any route. Wire it
into deploy/redeploy/clone-to-clab as a background watch task per lab name,
broadcasting node_state messages over the same run_id WS channel already
used for lifecycle logs. destroy() stops the watch for that lab."
```

---

## Task 3: Frontend — consume node_state messages and reflect them on the canvas

**Files:**
- Modify: `frontend/src/hooks/useLabControl.ts`

**Interfaces:**
- Consumes: WS message `{"type": "node_state", "node_id": string, "state": "running"|"stopped"}` (Task 2); `useLabStore.getState().setNodeState(nodeId, state)` and `clearNodeStates()` (already defined in `frontend/src/stores/lab-store.ts:20,41`); `NetworkNode.tsx` already reads `useLabStore((s) => nodeStates[nodeId])` and renders a state dot (`frontend/src/components/nodes/NetworkNode.tsx:40-70`) — no changes needed there.
- Produces: nothing new for other tasks.

- [ ] **Step 1: Clear stale node states when a new lifecycle run starts**

In `frontend/src/hooks/useLabControl.ts`, in `useLabControl()`, destructure `clearNodeStates` alongside the existing store getters:
```typescript
  const { setStatus, setRunId, appendLog, clearLogs, clearNodeStates } = useLabStore.getState();
```
In `startLifecycle`, right after `clearLogs();`, add:
```typescript
      clearNodeStates();
```

- [ ] **Step 2: Handle `node_state` messages in the WS `onmessage` handler**

Modify the `ws.onmessage` handler's message type to include the new fields, and add a branch:
```typescript
        try {
          const msg = JSON.parse(ev.data as string) as {
            type: string;
            line?: string;
            code?: number;
            message?: string;
            node_id?: string;
            state?: "running" | "stopped";
          };
          if (msg.type === "log" && msg.line !== undefined) {
            appendLog(msg.line);
          } else if (msg.type === "node_state" && msg.node_id && msg.state) {
            useLabStore.getState().setNodeState(msg.node_id, msg.state);
          } else if (msg.type === "exit") {
```
(Only the new `else if` branch and the widened type are additions — the rest of the handler is unchanged.)

- [ ] **Step 3: Manually verify in the dev server**

Run: `cd frontend && npm run dev`, open the app, load a topology with a real containerlab lab available, open Lab Control panel, click Deploy, and confirm node status dots on `NetworkNode` update as containers start (this requires a real containerlab environment — if unavailable, verify via `npm run build` that the TypeScript compiles with no type errors, since the message shape and store calls are the testable surface here).

Run: `cd frontend && npm run build`
Expected: build succeeds with no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/hooks/useLabControl.ts
git commit -m "feat: reflect live containerlab node state on canvas nodes

Consume the node_state WS messages added in the backend lifecycle watch task
and feed them into lab-store, which NetworkNode already rendered as a status
dot but had no data source for."
```

---

## Task 4: Containerlab lab selection — replace free-text path with a discoverable list

**Files:**
- Modify: `backend/api/routes/lab.py`
- Modify: `frontend/src/components/panels/LabControlPanel.tsx`
- Test: `backend/tests/test_api.py` (add one test)

**Interfaces:**
- Produces: `GET /api/lab/topologies` → `{"topologies": [{"name": str, "path": str}]}`, listing `*.clab.yml`/`*.clab.yaml` files found directly under `settings.clab_labs_dir` (non-recursive, matching how `clab_labs_dir` is already used elsewhere in this file).

- [ ] **Step 1: Write the failing test**

In `backend/tests/test_api.py`, add:
```python
def test_list_lab_topologies(client, tmp_path, monkeypatch):
    from api.config import settings
    monkeypatch.setattr(settings, "clab_labs_dir", tmp_path)
    (tmp_path / "spine-leaf.clab.yml").write_text("name: spine-leaf\n")
    (tmp_path / "not-a-lab.txt").write_text("ignore me\n")

    resp = client.get("/api/lab/topologies")

    assert resp.status_code == 200
    names = [t["name"] for t in resp.json()["topologies"]]
    assert names == ["spine-leaf"]
```
(If `backend/tests/test_api.py` does not already have a `client` fixture, check `backend/tests/conftest.py` for the existing fixture name used by other tests in that file and use that instead.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && uv run pytest tests/test_api.py::test_list_lab_topologies -v`
Expected: FAIL with 404 (route doesn't exist yet)

- [ ] **Step 3: Implement the endpoint**

In `backend/api/routes/lab.py`, add:
```python
@router.get("/topologies")
async def list_topologies() -> dict:
    """List discoverable containerlab topology files under clab_labs_dir."""
    base = settings.clab_labs_dir
    if not base.exists():
        return {"topologies": []}
    entries = []
    for pattern in ("*.clab.yml", "*.clab.yaml"):
        for p in sorted(base.glob(pattern)):
            name = p.name
            for ext in (".clab.yml", ".clab.yaml"):
                if name.endswith(ext):
                    name = name[: -len(ext)]
                    break
            entries.append({"name": name, "path": str(p)})
    return {"topologies": entries}
```
Place this above the existing `@router.post("/deploy")` route.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && uv run pytest tests/test_api.py::test_list_lab_topologies -v`
Expected: PASS

- [ ] **Step 5: Replace the free-text input with a dropdown in the frontend**

In `frontend/src/components/panels/LabControlPanel.tsx`, add state and a fetch effect, then render a `<select>` instead of the `<input type="text">` for the topology file:
```typescript
import { useEffect, useRef, useState } from "react";
```
(already imported — add nothing new to this line)

Inside `LabControlPanel()`, add:
```typescript
  const [availableLabs, setAvailableLabs] = useState<{ name: string; path: string }[]>([]);

  useEffect(() => {
    fetch("/api/lab/topologies")
      .then((r) => r.json())
      .then((data: { topologies: { name: string; path: string }[] }) => setAvailableLabs(data.topologies))
      .catch(() => setAvailableLabs([]));
  }, []);
```

Replace the existing topology file `<input type="text" ... />` block with:
```tsx
        <select
          value={topologyFile}
          onChange={(e) => setTopologyFile(e.target.value)}
          disabled={busy}
          className="w-full text-xs font-mono px-2 py-1.5 border rounded focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
        >
          <option value="">Select a lab…</option>
          {availableLabs.map((lab) => (
            <option key={lab.path} value={lab.path}>
              {lab.name}
            </option>
          ))}
        </select>
```

- [ ] **Step 6: Verify build**

Run: `cd frontend && npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 7: Commit**

```bash
git add backend/api/routes/lab.py backend/tests/test_api.py frontend/src/components/panels/LabControlPanel.tsx
git commit -m "feat: discoverable containerlab lab list instead of free-text path entry

Users previously had to type/remember the exact .clab.yml path. GET /api/lab/topologies
lists what's actually under clab_labs_dir; the Lab Control panel now offers a
dropdown built from that list."
```

---

## Task 5: Result summary banner after deploy/destroy/redeploy

**Files:**
- Modify: `frontend/src/stores/lab-store.ts`
- Modify: `frontend/src/hooks/useLabControl.ts`
- Modify: `frontend/src/components/panels/LabControlPanel.tsx`

**Interfaces:**
- Produces: `lab-store` gains `resultSummary: { ok: boolean; message: string } | null` and `setResultSummary(summary)`.

- [ ] **Step 1: Add `resultSummary` to the lab store**

In `frontend/src/stores/lab-store.ts`, add to the `LabState` interface:
```typescript
  resultSummary: { ok: boolean; message: string } | null;
```
and to the store body:
```typescript
  resultSummary: null,
  setResultSummary: (s) => set({ resultSummary: s }),
```
Add `setResultSummary: (s: { ok: boolean; message: string } | null) => void;` to the interface's action signatures.

- [ ] **Step 2: Populate the summary on WS exit and clear it on new run**

In `frontend/src/hooks/useLabControl.ts`:
- In `startLifecycle`, alongside the existing `clearLogs(); clearNodeStates();`, add:
```typescript
      useLabStore.getState().setResultSummary(null);
```
- In the `onmessage` handler's `exit` branch, replace:
```typescript
          } else if (msg.type === "exit") {
            setStatus(msg.code === 0 ? "done" : "error");
            closeWS();
          }
```
with:
```typescript
          } else if (msg.type === "exit") {
            const ok = msg.code === 0;
            setStatus(ok ? "done" : "error");
            useLabStore.getState().setResultSummary({
              ok,
              message: ok ? "Completed successfully." : `Exited with code ${msg.code}.`,
            });
            closeWS();
          }
```

- [ ] **Step 3: Render the summary banner in the panel**

In `frontend/src/components/panels/LabControlPanel.tsx`, destructure `resultSummary` from the store:
```typescript
  const resultSummary = useLabStore((s) => s.resultSummary);
```
Render it directly above the log viewer's `{showLogs && (...)}` block:
```tsx
      {resultSummary && (
        <div
          className={`px-3 py-2 text-xs font-medium ${
            resultSummary.ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {resultSummary.message}
        </div>
      )}
```

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/stores/lab-store.ts frontend/src/hooks/useLabControl.ts frontend/src/components/panels/LabControlPanel.tsx
git commit -m "feat: show a result summary banner after lab lifecycle operations

Previously the only way to learn why a deploy/destroy failed was to open the
raw log stream and scroll it. A one-line success/failure banner now surfaces
the outcome immediately."
```

---

## Task 6: Panel UX — stop background clicks from silently closing panels; add an explicit tab bar

**Files:**
- Modify: `frontend/src/components/TopologyCanvas.tsx`
- Modify: `frontend/src/stores/topology-store.ts`
- Create: `frontend/src/components/PanelTabBar.tsx`

**Interfaces:**
- Consumes: `useTopologyStore`'s existing `activePanel`, `setActivePanel`, `selectedNodeId`, `selectedLinkId`, `selectedAclName` (all already defined in `frontend/src/stores/topology-store.ts`).
- Produces: `PanelTabBar` component — no new store fields; reuses `setActivePanel`.

- [ ] **Step 1: Decouple toolbar-opened panels from selection-driven pane clicks**

In `frontend/src/stores/topology-store.ts`, change `selectNode` (currently sets `activePanel: nodeId ? (editMode ? "edit" : "detail") : null` around line 140) so that deselecting (`nodeId === null`) only clears `activePanel` if it is currently `"detail"` or `"edit"` — panels opened independently from the toolbar (`"packet"`, `"lab"`) must not be touched:
```typescript
    set((s) => ({
      selectedNodeId: nodeId,
      selectedLinkId: null,
      activePanel: nodeId
        ? (editMode ? "edit" : "detail")
        : (s.activePanel === "detail" || s.activePanel === "edit" ? null : s.activePanel),
    }));
```
Apply the same pattern to `selectLink` (only clears when `activePanel === "link-detail"`) and to `selectAcl` (only clears when `activePanel === "acl"`).

- [ ] **Step 2: Create an explicit tab bar so panels can be opened without clicking a canvas element**

Create `frontend/src/components/PanelTabBar.tsx`:
```tsx
import { useTopologyStore, type ActivePanel } from "../stores/topology-store";

const TABS: { id: Exclude<ActivePanel, null>; label: string }[] = [
  { id: "packet", label: "Packet Sim" },
  { id: "lab", label: "Lab Control" },
];

export function PanelTabBar() {
  const activePanel = useTopologyStore((s) => s.activePanel);
  const setActivePanel = useTopologyStore((s) => s.setActivePanel);

  return (
    <div className="flex gap-1 border-b border-slate-100 px-2 py-1 bg-white">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActivePanel(activePanel === tab.id ? null : tab.id)}
          className={`text-xs px-3 py-1.5 rounded transition-colors ${
            activePanel === tab.id
              ? "bg-blue-500 text-white"
              : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
```
This only covers the two toolbar-style panels (`packet`, `lab`) — `detail`/`link-detail`/`acl`/`edit` remain selection-driven by design, since they have no meaning without a selected node/link/ACL/edit-target.

- [ ] **Step 3: Mount the tab bar in `TopologyCanvas.tsx`**

In `frontend/src/components/TopologyCanvas.tsx`, import and render `PanelTabBar` directly below the existing `<SimToolbar .../><EditToolbar .../>` pair (near line 310-311):
```tsx
import { PanelTabBar } from "./PanelTabBar";
```
```tsx
      <SimToolbar onLayoutChange={handleLayoutChange} onLoadSample={handleLoadSample} />
      <EditToolbar onAddNode={handleAddNode} />
      <PanelTabBar />
```

- [ ] **Step 4: Manually verify in the dev server**

Run: `cd frontend && npm run dev`. Load a sample topology. Confirm:
- Clicking "Packet Sim" in the new tab bar opens the panel; clicking empty canvas space no longer closes it.
- Clicking a node still opens the node detail panel and clicking empty canvas still closes that one.
- Clicking "Packet Sim" while a node detail panel is open switches to Packet Sim (single-panel-at-a-time is preserved — this task fixes surprise auto-close and adds explicit navigation, not concurrent multi-panel display, which is out of scope here).

Run: `cd frontend && npm run build`
Expected: succeeds with no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/TopologyCanvas.tsx frontend/src/components/PanelTabBar.tsx frontend/src/stores/topology-store.ts
git commit -m "fix: stop background canvas clicks from silently closing toolbar panels

Packet Sim and Lab Control panels were opened via toolbar buttons but closed
as a side effect of clicking empty canvas space (which also deselects any
node/link/ACL). Selection-driven panels (detail/link-detail/acl/edit) still
close when their selection clears; toolbar panels now only close via their
own tab or explicit close button. Added an explicit tab bar so these two
panels don't require finding something to click on the canvas first."
```

---

## Explicitly deferred (needs its own plan — not built here)

These were identified during review but are large enough to need separate brainstorming/planning, not bolted onto this cleanup-and-wiring pass:

- **Multi-flow packet simulation** (view several src/dst/proto combinations at once instead of one at a time).
- **Live ACL re-poll** for already-deployed containerlab nodes (currently a one-shot snapshot from last collection).
- **Before/after diff view** (snapshot feature was removed; no replacement for comparing topology state over time).
- **Traffic bps visualization** — `traffic_in_bps`/`traffic_out_bps` are collected into the IR and exposed via Prometheus but never rendered anywhere in the app UI.
- **README/CLAUDE.md framing** of the "static analysis" vs "real infra control" dual-mode design — a documentation task, not code, but worth a deliberate pass once the two modes' UX (this plan) has settled.
