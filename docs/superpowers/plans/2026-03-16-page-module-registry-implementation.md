# Page Module Registry Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the frontend and backend around page-owned modules, with frontend routes and backend API/SPA routes aggregated from explicit module registries.

**Architecture:** Create explicit module registries on both frontend and backend. Move page-owned Vue files, models, composables, tests, and CSS into `frontend/src/modules/<page>/`. Move or wrap backend routers under `app/modules/<page>/`, then aggregate API routers and SPA routes from a shared backend registry.

**Tech Stack:** Vue 3, Vue Router, Vite, Vitest, FastAPI, Pytest

---

## Chunk 1: Registry Guardrails

### Task 1: Add failing frontend registry structure tests

**Files:**
- Create: `frontend/src/modules/modules.structure.test.js`
- Modify: `frontend/src/router/index.structure.test.js`

- [ ] **Step 1: Write the failing test**

Assert that:
- `src/router/index.js` imports routes from `src/modules/index.js`
- `src/router/index.js` no longer imports individual page components
- `src/modules/index.js` exports route definitions for current pages

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/router/index.structure.test.js src/modules/modules.structure.test.js`
Expected: FAIL because `src/modules/index.js` does not exist and router still imports page files directly.

- [ ] **Step 3: Write minimal implementation**

Create the modules registry file and refactor router imports to use it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/router/index.structure.test.js src/modules/modules.structure.test.js`
Expected: PASS

### Task 2: Add failing backend registry tests

**Files:**
- Create: `tests/api/test_module_registry.py`
- Modify: `tests/api/test_router_registry.py`
- Modify: `tests/web/test_spa_routes.py`

- [ ] **Step 1: Write the failing test**

Assert that:
- API routers come from `app.modules.registry`
- SPA routes come from `app.modules.registry`
- existing prefixes and SPA paths are preserved

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python.exe -m pytest tests/api/test_router_registry.py tests/api/test_module_registry.py tests/web/test_spa_routes.py -q`
Expected: FAIL because backend registry does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Add backend module registry, make route imports flow through it, and preserve the current public endpoints.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python.exe -m pytest tests/api/test_router_registry.py tests/api/test_module_registry.py tests/web/test_spa_routes.py -q`
Expected: PASS

## Chunk 2: Frontend Module Migration

### Task 3: Create shared boundaries and migrate page-owned Vue files

**Files:**
- Create: `frontend/src/modules/*/`
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/main.js`
- Modify: page runtime and structure tests under `frontend/src/modules/*/`

- [ ] **Step 1: Move page root components into page module directories**

Migrate each current file from `src/pages/` into `src/modules/<page>/page.vue`.

- [ ] **Step 2: Move page tests with the page**

Place current `*.runtime.test.js` and `*.structure.test.js` into the same page module directory and update imports.

- [ ] **Step 3: Add per-page `index.js` exports**

Each module exports `route`, `navigation` and `page component`.

- [ ] **Step 4: Refactor `App.vue` to read navigation metadata from registry**

Replace hardcoded nav links and title assumptions with registry-driven values.

- [ ] **Step 5: Run targeted frontend tests**

Run: `npm run test:run -- src/router/index.structure.test.js src/modules/modules.structure.test.js src/modules/**/**/*.test.js`
Expected: PASS for migrated page and registry tests.

### Task 4: Move page-specific composables, models, and components into modules

**Files:**
- Move: `frontend/src/composables/useDashboardPage.js`
- Move: `frontend/src/composables/useDataPage.js`
- Move: `frontend/src/composables/useDevicesPage.js`
- Move: `frontend/src/composables/useLoginForm.js`
- Move: `frontend/src/composables/useProcessLabs.js`
- Move: `frontend/src/composables/useSampleIntake.js`
- Move: `frontend/src/composables/useSamplesFlow.js`
- Move: `frontend/src/composables/useSamplesProcess.js`
- Move: `frontend/src/composables/useSampleTrace.js`
- Move: `frontend/src/composables/useSchedulePage.js`
- Move: `frontend/src/composables/useSystemPage.js`
- Move: `frontend/src/composables/useTaskOverview.js`
- Move: `frontend/src/composables/useTaskOverviewEditor.js`
- Move: `frontend/src/composables/useTasksPage.js`
- Move: page-owned models from `frontend/src/lib/*.js`
- Move: `frontend/src/components/task-overview/*`

- [ ] **Step 1: Add failing structure tests where needed**

For task overview and other complex pages, assert the page imports module-local helpers instead of top-level `composables/lib/components` paths.

- [ ] **Step 2: Move module-owned files**

Rehome page-owned files into each module directory and rewrite imports.

- [ ] **Step 3: Keep only true shared utilities in `src/shared/`**

Leave `AppDrawer`, `AppModal`, `AppPagination`, storage API, tab/dialog/table helpers, and similar cross-page utilities in shared.

- [ ] **Step 4: Run targeted frontend tests**

Run: `npm run test:run -- src/modules/**/**/*.test.js src/shared/**/*.test.js`
Expected: PASS

### Task 5: Split CSS into shared and module-level style files

**Files:**
- Modify: `frontend/src/assets/app.css`
- Replace: `frontend/src/assets/mes-app.css`
- Create: `frontend/src/shared/styles/base.css`
- Create: `frontend/src/shared/styles/shell.css`
- Create: `frontend/src/modules/*/styles.css`

- [ ] **Step 1: Write failing style structure tests**

Assert that page-specific selectors such as `task-overview-*`, `process-*`, `login-*`, `sample-*`, and dashboard-specific selectors are no longer stored only in one giant global file.

- [ ] **Step 2: Split shared shell/base styles out first**

Keep layout, typography, generic cards, tables, buttons, modals, and drawers in shared styles.

- [ ] **Step 3: Move page-prefixed CSS into page modules**

Import each page stylesheet from its module `index.js` or `page.vue`.

- [ ] **Step 4: Run style tests**

Run: `npm run test:run -- src/assets/*.test.js src/modules/**/**/*.test.js`
Expected: PASS

## Chunk 3: Backend Module Migration

### Task 6: Create backend page-module registry

**Files:**
- Create: `app/modules/__init__.py`
- Create: `app/modules/registry.py`
- Create: `app/modules/*/index.py`
- Modify: `app/main.py`
- Modify: `app/web/routes.py`

- [ ] **Step 1: Build registry with preserved router order**

The registry should expose:
- `MODULES`
- `get_api_routers()`
- `get_spa_routes()`

- [ ] **Step 2: Move or wrap existing API routers under page-domain modules**

Preserve current prefixes and behavior while changing the registration source.

- [ ] **Step 3: Update backend entry points**

Make `app.main` and `app.web.routes` depend on the registry.

- [ ] **Step 4: Run backend registry and SPA tests**

Run: `.\.venv\Scripts\python.exe -m pytest tests/api/test_router_registry.py tests/api/test_module_registry.py tests/web/test_spa_routes.py -q`
Expected: PASS

## Chunk 4: Cleanup and Verification

### Task 7: Remove obsolete top-level page files and dead imports

**Files:**
- Delete: `frontend/src/pages/*`
- Delete or shrink: obsolete top-level page-owned files from `frontend/src/composables`, `frontend/src/lib`, `frontend/src/components`

- [ ] **Step 1: Remove replaced files after imports are updated**

- [ ] **Step 2: Run repository-wide searches**

Run: `rg "@/pages|@/composables/use(Task|Sample|Schedule|Dashboard|Data|Devices|Login|Process|System)|@/components/task-overview|@/lib/(dashboardPageModel|dataPageModel|devicesPageModel|processLabModel|sampleIntakeModel|samplesFlowModel|samplesProcessModel|sampleTraceModel|schedulePageModel|systemPageModel|taskOverviewModel|tasksPageModel)" frontend/src -n`
Expected: only shared references remain where explicitly intended.

- [ ] **Step 3: Run focused verification**

Run: `npm run test:run`
Run: `.\.venv\Scripts\python.exe -m pytest tests/api/test_router_registry.py tests/web/test_spa_routes.py tests/api/test_health.py -q`
Expected: PASS for all selected checks.

- [ ] **Step 4: Review against the design**

Confirm frontend and backend registration now originate from module registries and page-owned files live under module directories.
