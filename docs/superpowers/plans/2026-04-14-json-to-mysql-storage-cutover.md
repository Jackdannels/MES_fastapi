# JSON To MySQL Storage Cutover Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gradually cut business storage over from JSON and frontend localStorage fallbacks to MySQL as the single runtime source of truth while preserving rollback switches during migration.

**Architecture:** First add storage observability and migration guardrails without changing behavior. Then switch the default runtime backend to `MySQLMesStorageBackend`, remove frontend business-data localStorage fallbacks, convert reset/init flows to MySQL, and finally delete JSON runtime responsibilities after verification. Keep the storage-adapter boundary intact so future MySQL -> DM migration replaces the database implementation rather than the whole app flow.

**Tech Stack:** FastAPI, Python storage backends, MySQL, pytest, Vue 3, Vitest, PowerShell scripts

---

## Chunk 1: Migration guardrails and observability

### Task 1: Add storage-mode diagnostics before changing defaults

**Files:**
- Modify: `app/core/config.py`
- Modify: `app/core/storage_backend.py`
- Modify: `app/api/routes/health.py`
- Modify: `tests/core/test_config_import.py`
- Modify: `tests/api/test_health.py`
- Modify: `tests/core/test_storage_backend.py`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- storage config defaults are explicit and inspectable
- health payload can report active storage backend and MySQL readiness
- bootstrap decisions are visible to callers or diagnostics

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_config_import.py tests/api/test_health.py tests/core/test_storage_backend.py -k "storage or health" -v`
Expected: FAIL because current config and health responses do not expose enough storage diagnostics

- [ ] **Step 3: Write minimal implementation**

Add explicit storage-related settings, expose active backend diagnostics from the storage layer, and extend `/health` so a failed MySQL dependency is visible before the default backend changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_config_import.py tests/api/test_health.py tests/core/test_storage_backend.py -k "storage or health" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/config.py app/core/storage_backend.py app/api/routes/health.py tests/core/test_config_import.py tests/api/test_health.py tests/core/test_storage_backend.py
git commit -m "feat: add storage migration diagnostics"
```

## Chunk 2: Switch the default runtime backend to MySQL

### Task 2: Make MySQL the default backend while keeping JSON bootstrap as a migration switch

**Files:**
- Modify: `app/core/config.py`
- Modify: `app/core/storage_backend.py`
- Modify: `app/core/mysql_storage_backend.py`
- Modify: `tests/core/test_storage_backend.py`
- Modify: `tests/core/test_mysql_storage_backend.py`
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- `STORAGE_BACKEND` defaults to `mysql`
- empty MySQL state can bootstrap once from JSON when enabled
- non-empty MySQL state does not keep re-importing JSON
- docs/examples point developers at MySQL-first startup

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -k "default or bootstrap" -v`
Expected: FAIL because the project still defaults to `json`

- [ ] **Step 3: Write minimal implementation**

Set MySQL as the default storage backend, tighten bootstrap conditions to one-time empty-state import behavior, and update local setup docs/env examples so developers start from the MySQL path by default.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -k "default or bootstrap" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/config.py app/core/storage_backend.py app/core/mysql_storage_backend.py tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py README.md .env.example
git commit -m "feat: default MES storage to mysql"
```

## Chunk 3: Remove frontend business-data localStorage fallbacks

### Task 3: Make frontend business reads and writes fail honestly instead of silently falling back

**Files:**
- Modify: `frontend/src/lib/storageApi.js`
- Modify: `frontend/src/lib/storageApi.test.js`
- Modify: `frontend/src/lib/tasksApi.js`
- Modify: `frontend/src/lib/tasksApi.test.js`
- Modify: `frontend/src/composables/useStorageSnapshot.js`
- Modify: touched runtime tests under:
  - `frontend/src/modules/tasks/`
  - `frontend/src/modules/samples/`
  - `frontend/src/modules/schedule/`
  - `frontend/src/modules/process/`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- business snapshot reads do not source truth from `localStorage`
- failed writes do not mutate local business caches and pretend success
- callers receive an error path they can surface in UI

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/lib/storageApi.test.js src/lib/tasksApi.test.js src/modules/samples/page.runtime.test.js src/modules/tasks/page.runtime.test.js`
Expected: FAIL because current API utilities still read/write business data in local storage

- [ ] **Step 3: Write minimal implementation**

Remove local-storage truth-source behavior from `storageApi.js` and `tasksApi.js`, keep only API-backed behavior for business data, and update callers/tests to surface load/save failures explicitly.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/lib/storageApi.test.js src/lib/tasksApi.test.js src/modules/samples/page.runtime.test.js src/modules/tasks/page.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/storageApi.js frontend/src/lib/storageApi.test.js frontend/src/lib/tasksApi.js frontend/src/lib/tasksApi.test.js frontend/src/composables/useStorageSnapshot.js frontend/src/modules/samples/page.runtime.test.js frontend/src/modules/tasks/page.runtime.test.js
git commit -m "feat: remove frontend business storage fallbacks"
```

## Chunk 4: Convert reset and initialization flows to MySQL-first

### Task 4: Separate runtime storage from migration and initialization scripts

**Files:**
- Modify: `app/core/demo_data_reset.py`
- Modify: `scripts/reset_demo_data.py`
- Create: `scripts/init_mysql_storage.py`
- Create: `scripts/migrate_json_to_mysql.py`
- Modify: `tests/core/test_storage_backend.py`
- Modify: `tests/core/test_mysql_storage_backend.py`
- Modify: `README.md`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- demo reset can rebuild MySQL without rewriting JSON as a runtime dependency
- JSON import is available as an explicit script path rather than a hidden runtime behavior
- developer setup docs distinguish dev auto-init from explicit script init

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -k "reset or migrate" -v`
Expected: FAIL because reset logic still rewrites JSON and no explicit migration/init scripts exist

- [ ] **Step 3: Write minimal implementation**

Refactor demo reset so MySQL is the first-class target, add explicit init and JSON-import scripts, and document how dev auto-init differs from manual initialization.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -k "reset or migrate" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/demo_data_reset.py scripts/reset_demo_data.py scripts/init_mysql_storage.py scripts/migrate_json_to_mysql.py tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py README.md
git commit -m "feat: add mysql-first init and migration scripts"
```

## Chunk 5: Remove JSON runtime responsibilities

### Task 5: Delete JSON as a runtime storage mode after MySQL path is stable

**Files:**
- Modify: `app/core/storage_backend.py`
- Modify: `tests/core/test_storage_backend.py`
- Modify: `tests/conftest.py`
- Modify: `README.md`
- Modify: `.env.example`
- Delete or demote runtime references to: `app/data/mes_store.json`

- [ ] **Step 1: Write the failing test**

Add tests proving:
- business runtime no longer depends on `JsonFileStorage`
- deleting `app/data/mes_store.json` does not break a correctly initialized MySQL setup
- test defaults now run against MySQL fixtures instead of JSON mode

- [ ] **Step 2: Run test to verify it fails**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/conftest.py -k "mysql" -v`
Expected: FAIL because JSON is still treated as a supported runtime backend

- [ ] **Step 3: Write minimal implementation**

Remove JSON runtime selection from the storage entrypoint, keep JSON only for explicit import tooling if still needed, and update tests/docs so MySQL is the only supported runtime mode.

- [ ] **Step 4: Run test to verify it passes**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py tests/api/test_health.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/storage_backend.py tests/core/test_storage_backend.py tests/conftest.py README.md .env.example app/data/mes_store.json
git commit -m "refactor: remove json runtime storage mode"
```

## Chunk 6: Final verification

### Task 6: Run focused regression suites against the MySQL-first path

**Files:**
- Test: `tests/core/test_storage_backend.py`
- Test: `tests/core/test_mysql_storage_backend.py`
- Test: `tests/api/test_health.py`
- Test: `tests/api/test_tasks.py`
- Test: `frontend/src/lib/storageApi.test.js`
- Test: `frontend/src/lib/tasksApi.test.js`
- Test: touched frontend runtime tests

- [ ] **Step 1: Run backend verification**

Run: `.venv\Scripts\python.exe -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py tests/api/test_health.py tests/api/test_tasks.py -v`
Expected: PASS

- [ ] **Step 2: Run frontend verification**

Run: `npm run test:run -- src/lib/storageApi.test.js src/lib/tasksApi.test.js src/modules/samples/page.runtime.test.js src/modules/tasks/page.runtime.test.js src/modules/schedule/page.runtime.test.js`
Expected: PASS

- [ ] **Step 3: Run migration scripts smoke checks**

Run: `powershell -NoProfile -Command "python scripts/reset_demo_data.py"`
Expected: completes against MySQL without relying on JSON as the runtime source

- [ ] **Step 4: Review diff**

Run: `git diff -- app/core/config.py app/core/storage_backend.py app/core/mysql_storage_backend.py app/core/demo_data_reset.py frontend/src/lib/storageApi.js frontend/src/lib/tasksApi.js README.md .env.example`
Expected: diff only contains MySQL cutover, frontend fallback removal, and initialization cleanup
