# MES Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the highest-risk structural issues in this FastAPI + Vue MES project so routing, UI runtime, storage, and authentication all have one clear implementation path.

**Architecture:** Refactor in three phases. First, fix broken runtime boundaries by making SPA routing complete and selecting one frontend runtime per page. Second, consolidate storage and API access so frontend pages and backend routes stop duplicating state logic. Third, harden auth and project hygiene with tests, tooling, and cleanup of generated artifacts.

**Tech Stack:** FastAPI, Pydantic, dmPython, Vue 3, Vue Router, Vite, pytest, Vitest, ESLint

---

## Scope and Constraints

- Current backend routes live under `app/api/routes/` and `app/web/routes.py`.
- Current frontend app lives under `frontend/src/`.
- Legacy DOM-driven UI still lives under `app/static/js/`.
- The repo currently contains checked-in build output under `app/static/dist/` and checked-in dependencies under `frontend/node_modules/`.
- There are currently no automated tests in the repository; this plan adds the minimum guardrails before larger refactors.

## Target File Structure

### Backend

- Modify: `app/web/routes.py`
  Purpose: serve the SPA for every Vue history route that should deep-link correctly.
- Modify: `app/main.py`
  Purpose: simplify router registration and keep web/API boundaries obvious.
- Create: `app/api/routes/crud_factory.py`
  Purpose: hold reusable CRUD router generation for the repeated in-memory resource modules.
- Modify: `app/api/routes/workflows.py`
- Modify: `app/api/routes/technologies.py`
- Modify: `app/api/routes/manufactureplan.py`
- Modify: `app/api/routes/device.py`
- Modify: `app/api/routes/material.py`
- Modify: `app/api/routes/warehouse.py`
- Modify: `app/api/routes/quality.py`
- Modify: `app/api/routes/report.py`
- Modify: `app/api/routes/yt_log.py`
- Modify: `app/api/routes/yt_report.py`
  Purpose: migrate duplicated CRUD handlers to the shared CRUD factory.
- Modify: `app/api/routes/health.py`
  Purpose: return controlled unhealthy responses instead of raw 500s.
- Modify: `app/db/session.py`
  Purpose: centralize connection error behavior.

### Frontend

- Modify: `frontend/src/App.vue`
  Purpose: stop auto-booting legacy scripts for the Vue application shell.
- Delete or isolate later: `frontend/src/legacy/boot.js`
  Purpose: remove the runtime bridge once no page depends on the old DOM UI.
- Create: `frontend/src/lib/storageKeys.js`
  Purpose: one source of truth for frontend storage keys.
- Create: `frontend/src/lib/storageApi.js`
  Purpose: centralized read/write access to `/api/storage`.
- Create: `frontend/src/composables/useStorageSnapshot.js`
  Purpose: shared snapshot loading with error handling and fallback policy.
- Create: `frontend/src/components/task-overview/TaskOverviewFilters.vue`
- Create: `frontend/src/components/task-overview/TaskOverviewCard.vue`
- Create: `frontend/src/components/task-overview/TaskOverviewTrayTable.vue`
- Create: `frontend/src/composables/useTaskOverview.js`
  Purpose: split `TaskOverviewPage.vue` into focused units.
- Modify: `frontend/src/pages/TaskOverviewPage.vue`
- Modify: `frontend/src/pages/ProcessPage.vue`
  Purpose: both pages use the shared storage snapshot/composable path.
- Modify: `frontend/src/auth.js`
- Modify: `frontend/src/pages/LoginPage.vue`
  Purpose: replace hardcoded demo auth with backend-backed auth or clearly marked development stub mode.
- Create: `frontend/src/lib/appConfig.js`
  Purpose: hold environment-driven flags like demo mode.
- Modify: `frontend/src/assets/app.css`
- Modify: `frontend/vite.config.js`
  Purpose: reduce tight coupling to backend static assets and make build behavior explicit.

### Tests and Tooling

- Create: `tests/conftest.py`
- Create: `tests/web/test_spa_routes.py`
- Create: `tests/api/test_health.py`
- Create: `tests/api/test_crud_factory.py`
  Purpose: backend smoke coverage for the refactor.
- Create: `frontend/vitest.config.js`
- Create: `frontend/src/lib/storageApi.test.js`
- Create: `frontend/src/composables/useTaskOverview.test.js`
- Create: `frontend/.eslintrc.cjs`
  Purpose: minimal frontend verification and linting.
- Modify: `frontend/package.json`
  Purpose: add `lint`, `test`, and `test:run` scripts.
- Create: `.gitignore`
  Purpose: stop tracking `frontend/node_modules`, `app/static/dist`, Python caches, and local env files.
- Modify: `README.md`
  Purpose: document the chosen runtime, test commands, and build flow.

## Chunk 1: Stabilize Runtime Boundaries

### Task 1: Add backend tests for SPA deep links

**Files:**
- Create: `tests/conftest.py`
- Create: `tests/web/test_spa_routes.py`
- Modify: `requirements.txt`

- [ ] **Step 1: Write the failing tests**

```python
from fastapi.testclient import TestClient


def test_spa_routes_return_index_html(client: TestClient):
    for path in ["/", "/login", "/task-overview", "/visualization", "/staging-management"]:
        response = client.get(path)
        assert response.status_code == 200


def test_unknown_backend_route_does_not_mask_api_paths(client: TestClient):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/web/test_spa_routes.py -v`
Expected: FAIL because the current backend only serves a subset of Vue routes.

- [ ] **Step 3: Write minimal implementation**

```python
SPA_PATHS = (
    "/",
    "/login",
    "/task-overview",
    "/tasks",
    "/schedule",
    "/samples",
    "/process",
    "/devices",
    "/data",
    "/system",
    "/visualization",
    "/staging-management",
)

for path in SPA_PATHS:
    router.add_api_route(path, spa_response, methods=["GET"])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/web/test_spa_routes.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add tests/conftest.py tests/web/test_spa_routes.py app/web/routes.py requirements.txt
git commit -m "test: cover spa history routes"
```

### Task 2: Stop booting the legacy DOM runtime inside the Vue shell

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/main.js`
- Test: `frontend/src/lib/storageApi.test.js`

- [ ] **Step 1: Write the failing regression test**

```js
import { mount } from "@vue/test-utils";
import App from "../App.vue";

test("central layout does not inject legacy script tags", async () => {
  const wrapper = mount(App, { global: { stubs: ["RouterView", "RouterLink"] } });
  expect(document.querySelector('script[src="/static/js/main.js"]')).toBeNull();
  wrapper.unmount();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- --runInBand`
Expected: FAIL because `App.vue` still calls `bootLegacyUI()`.

- [ ] **Step 3: Write minimal implementation**

```vue
<script setup>
const legacyModeEnabled = false;
</script>
```

And remove:

```js
import { bootLegacyUI } from "./legacy/boot.js";
onMounted(runLegacyBoot);
watch(() => [route.path, currentModule.value, isAuthLayout.value], () => {
  runLegacyBoot();
});
```

- [ ] **Step 4: Run the frontend build and test**

Run: `cd frontend; npm run build; npm run test:run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.vue frontend/src/main.js frontend/src/lib/storageApi.test.js frontend/package.json frontend/vitest.config.js
git commit -m "refactor: remove legacy runtime boot from vue shell"
```

### Task 3: Decide the fate of legacy UI assets

**Files:**
- Modify: `README.md`
- Modify: `app/static/js/main.js`
- Modify: `frontend/src/legacy/boot.js` or delete it

- [ ] **Step 1: Record whether any production route still depends on legacy DOM handlers**

Run: `rg "data-modal|data-drawer|__MES_LEGACY_BOOT__|bootLegacyUI" frontend/src app/static/js -n`
Expected: A finite list of remaining legacy entry points.

- [ ] **Step 2: If no routes depend on legacy boot, delete the bridge**

```bash
git rm frontend/src/legacy/boot.js
```

- [ ] **Step 3: If some routes still depend on it, explicitly isolate them behind a feature flag**

```js
export const appConfig = {
  enableLegacyUi: false,
};
```

- [ ] **Step 4: Document the chosen mode**

Update `README.md` with one sentence stating whether legacy static JS is still supported.

- [ ] **Step 5: Commit**

```bash
git add README.md app/static/js/main.js frontend/src/legacy/boot.js frontend/src/lib/appConfig.js
git commit -m "docs: document frontend runtime boundary"
```

## Chunk 2: Consolidate State and Backend Abstractions

### Task 4: Add a shared frontend storage API layer

**Files:**
- Create: `frontend/src/lib/storageKeys.js`
- Create: `frontend/src/lib/storageApi.js`
- Create: `frontend/src/composables/useStorageSnapshot.js`
- Create: `frontend/src/lib/storageApi.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { describe, expect, test, vi } from "vitest";
import { readStorageSnapshot } from "./storageApi";

test("returns normalized task and schedule arrays", async () => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      "mes.tasks": [{ code: "T-1" }],
      "mes.schedules": [{ task_code: "T-1" }],
    }),
  });

  const snapshot = await readStorageSnapshot(["mes.tasks", "mes.schedules"]);
  expect(snapshot["mes.tasks"]).toHaveLength(1);
  expect(snapshot["mes.schedules"]).toHaveLength(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- storageApi.test.js`
Expected: FAIL because the shared API layer does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export const STORAGE_KEYS = {
  tasks: "mes.tasks",
  schedules: "mes.schedules",
  samples: "mes.samples",
  devices: "mes.devices",
  streams: "mes.streams",
  conflicts: "mes.conflicts",
};

export async function readStorageSnapshot(keys) {
  const response = await fetch("/api/storage", { headers: { Accept: "application/json" } });
  const payload = response.ok ? await response.json() : {};
  return Object.fromEntries(keys.map((key) => [key, Array.isArray(payload[key]) ? payload[key] : []]));
}
```

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- storageApi.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/storageKeys.js frontend/src/lib/storageApi.js frontend/src/composables/useStorageSnapshot.js frontend/src/lib/storageApi.test.js frontend/package.json frontend/vitest.config.js
git commit -m "refactor: centralize frontend storage access"
```

### Task 5: Move `TaskOverviewPage` logic into a composable and child components

**Files:**
- Create: `frontend/src/composables/useTaskOverview.js`
- Create: `frontend/src/components/task-overview/TaskOverviewFilters.vue`
- Create: `frontend/src/components/task-overview/TaskOverviewCard.vue`
- Create: `frontend/src/components/task-overview/TaskOverviewTrayTable.vue`
- Modify: `frontend/src/pages/TaskOverviewPage.vue`
- Create: `frontend/src/composables/useTaskOverview.test.js`

- [ ] **Step 1: Write a failing composable test**

```js
import { describe, expect, test } from "vitest";
import { buildOverviewRows } from "./useTaskOverview";

test("groups schedules and samples by task code", () => {
  const rows = buildOverviewRows({
    tasks: [{ code: "T-1", test_type: "冲击试验" }],
    samples: [{ task_code: "T-1", sample_code: "S-1" }],
    schedules: [{ task_code: "T-1", device: "冲击一室" }],
    streams: [],
  });

  expect(rows[0].taskCode).toBe("T-1");
  expect(rows[0].sampleCodes).toEqual(["S-1"]);
  expect(rows[0].scheduleCount).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- useTaskOverview.test.js`
Expected: FAIL because the composable does not exist.

- [ ] **Step 3: Write minimal implementation and split the page**

```js
export function buildOverviewRows({ tasks, samples, schedules, streams }) {
  // move row aggregation logic here from TaskOverviewPage.vue
}
```

And update `TaskOverviewPage.vue` so it mainly wires:

```js
const {
  loading,
  filteredRows,
  trayOverviewRows,
  loadOverview,
  saveEdit,
  confirmDeleteTask,
} = useTaskOverview();
```

- [ ] **Step 4: Run tests and build**

Run: `cd frontend; npm run test:run -- useTaskOverview.test.js; npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useTaskOverview.js frontend/src/components/task-overview frontend/src/pages/TaskOverviewPage.vue frontend/src/composables/useTaskOverview.test.js
git commit -m "refactor: split task overview page"
```

### Task 6: Reuse the shared storage snapshot in `ProcessPage`

**Files:**
- Modify: `frontend/src/pages/ProcessPage.vue`
- Modify: `frontend/src/composables/useStorageSnapshot.js`
- Test: `frontend/src/lib/storageApi.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("process page card builder consumes shared snapshot shape", async () => {
  const snapshot = {
    "mes.tasks": [{ code: "T-1", test_type: "冲击试验" }],
    "mes.schedules": [{ task_code: "T-1", device: "冲击一室" }],
  };
  expect(buildLabCardsFromSnapshot(snapshot)).toHaveLength(10);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- storageApi.test.js`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

Replace ad hoc code like:

```js
const STORAGE_KEYS = { tasks: "mes.tasks", schedules: "mes.schedules" };
const readStorageSnapshot = async () => { ... };
```

with:

```js
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { useStorageSnapshot } from "@/composables/useStorageSnapshot";
```

- [ ] **Step 4: Run test and build**

Run: `cd frontend; npm run test:run; npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ProcessPage.vue frontend/src/composables/useStorageSnapshot.js frontend/src/lib/storageApi.test.js
git commit -m "refactor: reuse shared storage snapshot in process page"
```

### Task 7: Introduce a backend CRUD router factory

**Files:**
- Create: `app/api/routes/crud_factory.py`
- Modify: `app/api/routes/workflows.py`
- Modify: `app/api/routes/technologies.py`
- Modify: `app/api/routes/manufactureplan.py`
- Modify: `app/api/routes/device.py`
- Modify: `app/api/routes/material.py`
- Modify: `app/api/routes/warehouse.py`
- Modify: `app/api/routes/quality.py`
- Modify: `app/api/routes/report.py`
- Modify: `app/api/routes/yt_log.py`
- Modify: `app/api/routes/yt_report.py`
- Create: `tests/api/test_crud_factory.py`

- [ ] **Step 1: Write the failing backend test**

```python
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.routes.crud_factory import build_crud_router


def test_generated_crud_router_supports_full_lifecycle():
    app = FastAPI()
    app.include_router(build_crud_router("/widgets", "widgets", "Widget"))
    client = TestClient(app)

    created = client.post("/widgets", json={"name": "A"}).json()
    fetched = client.get(f"/widgets/{created['id']}")

    assert fetched.status_code == 200
    assert fetched.json()["name"] == "A"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/api/test_crud_factory.py -v`
Expected: FAIL because the factory does not exist.

- [ ] **Step 3: Write minimal implementation**

```python
def build_crud_router(prefix: str, tag: str, label: str) -> APIRouter:
    router = APIRouter(prefix=prefix, tags=[tag])
    store = InMemoryStore()
    ...
    return router
```

- [ ] **Step 4: Migrate one route first, then the rest**

Start with `app/api/routes/workflows.py`, then replace the repeated route bodies in the other CRUD modules.

- [ ] **Step 5: Run tests**

Run: `pytest tests/api/test_crud_factory.py -v`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add app/api/routes/crud_factory.py app/api/routes/*.py tests/api/test_crud_factory.py
git commit -m "refactor: share duplicated crud route logic"
```

### Task 8: Normalize health-check failures

**Files:**
- Modify: `app/api/routes/health.py`
- Modify: `app/db/session.py`
- Create: `tests/api/test_health.py`

- [ ] **Step 1: Write the failing tests**

```python
def test_health_db_returns_unhealthy_response_when_driver_missing(client):
    response = client.get("/health/db")
    assert response.status_code == 503
    assert response.json()["status"] == "unhealthy"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/api/test_health.py -v`
Expected: FAIL because the current endpoint raises an exception.

- [ ] **Step 3: Write minimal implementation**

```python
@router.get("/db")
def health_db():
    try:
        conn = get_connection()
    except RuntimeError as exc:
        return JSONResponse(status_code=503, content={"status": "unhealthy", "detail": str(exc)})
```

- [ ] **Step 4: Run tests**

Run: `pytest tests/api/test_health.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/routes/health.py app/db/session.py tests/api/test_health.py
git commit -m "fix: return controlled db health failures"
```

## Chunk 3: Harden Authentication and Project Hygiene

### Task 9: Replace hardcoded frontend-only authentication

**Files:**
- Create: `app/api/routes/auth.py`
- Modify: `app/main.py`
- Modify: `frontend/src/auth.js`
- Modify: `frontend/src/pages/LoginPage.vue`
- Create: `frontend/src/lib/appConfig.js`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing backend auth test**

```python
def test_login_rejects_invalid_credentials(client):
    response = client.post("/auth/login", json={"username": "bad", "password": "bad"})
    assert response.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/api/test_auth.py -v`
Expected: FAIL because no auth route exists.

- [ ] **Step 3: Write minimal implementation**

```python
@router.post("/login")
def login(payload: LoginRequest):
    if payload.username != settings.DEMO_USER or payload.password != settings.DEMO_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    return {"username": payload.username, "module": payload.module}
```

And change frontend login from:

```js
if (user !== DEFAULT_CREDENTIALS.username || pass !== DEFAULT_CREDENTIALS.password) {
```

to:

```js
const response = await fetch("/auth/login", { method: "POST", ... });
```

- [ ] **Step 4: Run tests and build**

Run: `pytest tests/api/test_auth.py -v`
Run: `cd frontend; npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/api/routes/auth.py app/main.py frontend/src/auth.js frontend/src/pages/LoginPage.vue frontend/src/lib/appConfig.js .env.example tests/api/test_auth.py
git commit -m "feat: move demo auth behind backend api"
```

### Task 10: Add frontend linting and test scripts

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/.eslintrc.cjs`
- Create: `frontend/vitest.config.js`

- [ ] **Step 1: Add the failing scripts**

```json
{
  "scripts": {
    "lint": "eslint src --ext .js,.vue",
    "test": "vitest",
    "test:run": "vitest run"
  }
}
```

- [ ] **Step 2: Run lint to see the current failure set**

Run: `cd frontend; npm run lint`
Expected: FAIL until config and code are aligned.

- [ ] **Step 3: Add minimal config and fix only blocking issues introduced by the refactor**

```js
module.exports = {
  root: true,
  env: { browser: true, es2022: true },
};
```

- [ ] **Step 4: Run lint and tests**

Run: `cd frontend; npm run lint; npm run test:run`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/.eslintrc.cjs frontend/vitest.config.js
git commit -m "chore: add frontend lint and test scripts"
```

### Task 11: Clean the repository and document the build boundary

**Files:**
- Create: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Create `.gitignore` entries**

```gitignore
.venv/
__pycache__/
*.pyc
frontend/node_modules/
frontend/.vite/
app/static/dist/
.env
```

- [ ] **Step 2: Stop tracking generated files**

Run:

```bash
git rm -r --cached frontend/node_modules app/static/dist
```

Expected: staged removal of generated dependencies and build output only.

- [ ] **Step 3: Update the README**

Document:
- backend startup
- frontend dev mode
- frontend build output contract
- pytest commands
- frontend lint/test commands

- [ ] **Step 4: Verify working tree contents**

Run: `git status --short`
Expected: only intended source/doc/config changes remain staged.

- [ ] **Step 5: Commit**

```bash
git add .gitignore README.md
git commit -m "chore: ignore generated artifacts and document workflow"
```

## Verification Checklist

- Backend:
  Run: `pytest -v`
  Expected: all backend tests pass.
- Frontend:
  Run: `cd frontend; npm run lint; npm run test:run; npm run build`
  Expected: all commands pass.
- Manual:
  Run the app and verify direct navigation to `/login`, `/task-overview`, `/visualization`, and `/staging-management` returns the SPA instead of 404.
- Manual:
  Verify no `<script src="/static/js/main.js">` is injected by the Vue shell unless a deliberate feature flag enables legacy mode.

## Recommended Execution Order

1. Chunk 1 first, because it removes the most dangerous runtime ambiguity.
2. Chunk 2 second, because shared state/API abstractions are easier once the runtime boundary is clean.
3. Chunk 3 last, because auth/tooling cleanup should land on top of the stabilized architecture.

## Notes for the Implementer

- Do not try to migrate everything from legacy static JS in one commit.
- Keep each refactor step behavior-preserving unless the step explicitly fixes a bug.
- Prefer introducing shared abstractions only after at least one failing test proves the repeated behavior.
- If the team decides to keep demo auth temporarily, make that an explicit config mode, not a hardcoded default in shipped frontend code.
