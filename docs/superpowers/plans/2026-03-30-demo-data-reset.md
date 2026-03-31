# Demo Data Reset Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repeatable reset flow that wipes current business demo data and regenerates 20 fresh `SYLU-2026-03-001` to `SYLU-2026-03-020` tasks with 10 external, 10 internal, and 3 random experiments per task.

**Architecture:** Introduce a focused demo-data generator that produces a full storage snapshot, then add a reset entrypoint that rewrites `app/data/mes_store.json` and re-seeds MySQL business tables from the same snapshot. Keep device/config data untouched and verify the reset through storage-level tests instead of relying on manual inspection.

**Tech Stack:** Python, pytest, existing storage backends (`JsonFileStorage`, `MySQLMesStorageBackend`), PowerShell for invoking scripts.

---

## File Map

- Create: `scripts/reset_demo_data.py`
- Create: `app/core/demo_data_reset.py`
- Modify: `app/core/storage_backend.py`
- Modify: `app/core/mysql_storage_backend.py`
- Modify: `tests/core/test_storage_backend.py`
- Modify: `tests/core/test_mysql_storage_backend.py`
- Modify: `README.md`

## Chunk 1: Demo Snapshot Generator

### Task 1: Add a failing storage-level test for generated baseline shape

**Files:**
- Modify: `tests/core/test_storage_backend.py`
- Implement later in: `app/core/demo_data_reset.py`

- [ ] **Step 1: Write the failing test**

Add a test that calls a new generator function and asserts:
- exactly 20 tasks
- task codes span `SYLU-2026-03-001` to `SYLU-2026-03-020`
- first 10 sources are `外部委托`
- last 10 sources are `内部新增`
- each task has exactly 3 experiment codes
- each task sample count is greater than 4
- schedules / experiment tray mappings / conflicts are empty

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python -m pytest tests/core/test_storage_backend.py -k demo_reset`

Expected: FAIL because the generator function does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `app/core/demo_data_reset.py` with:
- a task code builder for `001-020`
- a trial-type pool drawn from existing supported experiment names
- a snapshot generator function returning normalized storage payload
- random sample count generation constrained to `> 4`

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python -m pytest tests/core/test_storage_backend.py -k demo_reset`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/demo_data_reset.py tests/core/test_storage_backend.py
git commit -m "feat: add demo data snapshot generator"
```

### Task 2: Refine the generator to match storage normalization rules

**Files:**
- Modify: `app/core/demo_data_reset.py`
- Modify: `tests/core/test_storage_backend.py`

- [ ] **Step 1: Write the failing test**

Add assertions that generated tasks, samples, and experiments match current storage conventions:
- tasks include `experiment_codes` and `experiment_count`
- sample codes follow `TASK-SP-001`
- experiment codes follow `TASK-A/B/C`
- generated payload can be consumed by `normalize_storage_payload`

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python -m pytest tests/core/test_storage_backend.py -k demo_reset_normalized`

Expected: FAIL on missing fields or wrong shape.

- [ ] **Step 3: Write minimal implementation**

Update the generator to emit fields expected by current routes and storage helpers, using existing naming conventions instead of inventing new ones.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python -m pytest tests/core/test_storage_backend.py -k demo_reset_normalized`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/demo_data_reset.py tests/core/test_storage_backend.py
git commit -m "feat: normalize generated demo reset payload"
```

## Chunk 2: Reset Entry Point

### Task 3: Add a failing test for MySQL reset behavior

**Files:**
- Modify: `tests/core/test_mysql_storage_backend.py`
- Implement later in: `app/core/demo_data_reset.py`
- Implement later in: `app/core/mysql_storage_backend.py`

- [ ] **Step 1: Write the failing test**

Add a test covering a new reset function that:
- clears current business storage collections
- writes the new generated snapshot
- keeps device/config collections untouched

Use monkeypatches around MySQL backend internals to assert the reset writes fresh `mes.tasks`, `mes.samples`, and `mes.experiments`, and clears schedules / tray mappings / conflicts.

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python -m pytest tests/core/test_mysql_storage_backend.py -k demo_reset`

Expected: FAIL because no reset API exists yet.

- [ ] **Step 3: Write minimal implementation**

Add reset helpers in `app/core/demo_data_reset.py` and extend MySQL-side support only as needed so the reset can:
- generate the snapshot
- write the snapshot to JSON
- replace business tables in MySQL from that snapshot

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python -m pytest tests/core/test_mysql_storage_backend.py -k demo_reset`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/demo_data_reset.py app/core/mysql_storage_backend.py tests/core/test_mysql_storage_backend.py
git commit -m "feat: add mysql-backed demo data reset"
```

### Task 4: Add the executable reset script

**Files:**
- Create: `scripts/reset_demo_data.py`
- Modify: `app/core/storage_backend.py`
- Test via existing core tests plus script smoke-check

- [ ] **Step 1: Write the failing test**

Add or extend a test that expects a script-level or helper-level entrypoint to exist and call the reset helper with the default store path / configured storage backend.

- [ ] **Step 2: Run test to verify it fails**

Run: `.\.venv\Scripts\python -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -k demo_reset_entrypoint`

Expected: FAIL because the entrypoint does not exist yet.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/reset_demo_data.py` that:
- gets the configured storage backend
- invokes the demo reset helper
- prints a compact summary: task count, sample count, experiment count

If `storage_backend.py` needs a small helper to expose current backend details cleanly, add the smallest possible change there.

- [ ] **Step 4: Run test to verify it passes**

Run: `.\.venv\Scripts\python -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py -k demo_reset_entrypoint`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/reset_demo_data.py app/core/storage_backend.py tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py
git commit -m "feat: add demo data reset script"
```

## Chunk 3: Verification and Documentation

### Task 5: Verify full reset behavior end-to-end

**Files:**
- Verify: `scripts/reset_demo_data.py`
- Verify: `app/data/mes_store.json`

- [ ] **Step 1: Run the reset script in the local environment**

Run: `.\.venv\Scripts\python scripts/reset_demo_data.py`

Expected:
- script exits `0`
- output reports 20 tasks and 60 experiments

- [ ] **Step 2: Run focused regression suites**

Run: `.\.venv\Scripts\python -m pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py tests/api/test_transfer_area.py tests/api/test_tasks.py`

Expected: PASS with zero failures

- [ ] **Step 3: Do a storage smoke-check**

Run a one-off Python snippet to assert:
- 20 tasks in `read_all()`
- no schedules
- no experiment tray mappings
- task sources split 10/10

- [ ] **Step 4: Commit**

```bash
git add app/data/mes_store.json
git commit -m "chore: reset demo task data baseline"
```

### Task 6: Document operator usage

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the failing doc expectation**

Add a lightweight test only if the repo already tests README structure; otherwise skip test creation and document directly in the next step.

- [ ] **Step 2: Update documentation**

Document:
- what the reset script does
- that it is destructive
- how to run it
- what baseline data it generates

- [ ] **Step 3: Verify docs are accurate**

Re-read the documented command and confirm it matches the actual script path and behavior.

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: document demo data reset workflow"
```

Plan complete and saved to `docs/superpowers/plans/2026-03-30-demo-data-reset.md`. Ready to execute?
