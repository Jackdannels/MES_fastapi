# SYLU 任务编号迁移与接驳区实验切换 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all task-linked data to the `SYLU-YYYY-MM-NNN` numbering scheme, backfill historical multi-experiment tasks, and update scheduling plus handover so experiments are displayed and switched by real experiment type.

**Architecture:** Add a single normalization and migration path in storage so old JSON/MySQL data is converted once into the new numbering and experiment model, then update frontend modules to consume only migrated task/experiment records. Keep task ownership as the primary spine, derive experiment display labels from experiment type, and make handover default to task tray editing with experiment-type quick switches.

**Tech Stack:** FastAPI, Vue 3, JSON snapshot storage, MySQL mapping layer, pytest, Vitest

---

## File Structure

- Modify: `app/core/storage_backend.py`
  - Add schema version handling, task-code migration helpers, and migrated snapshot defaults
- Modify: `app/core/mysql_storage_backend.py`
  - Apply the same migration rules to MySQL-backed rows and persist migrated task / experiment / schedule identifiers
- Modify: `app/db/mysql_snapshot.py`
  - Ensure migrated snapshot reads/writes preserve schema metadata
- Modify: `app/data/mes_store.json`
  - Seed data in migrated `SYLU` format and include backfilled historical multi-experiment tasks
- Modify: `tests/core/test_storage_backend.py`
  - Verify snapshot migration, idempotence, and historical multi-experiment backfill
- Modify: `tests/core/test_mysql_storage_backend.py`
  - Verify MySQL row normalization and identifier rewrites
- Modify: `app/api/routes/transfer_area.py`
  - Return experiment-type summaries and workspace data aligned with migrated task numbers
- Modify: `tests/api/test_transfer_area.py`
  - Verify workspace payloads, experiment-type tabs, and migrated identifiers
- Modify: `frontend/src/modules/schedule/model.js`
  - Build experiment options from migrated records and render experiment-type labels with full-code traceability
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
  - Consume migrated task/experiment options only
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`
  - Verify `GDW-2024-005`-style historical tasks now expose full experiment lists
- Modify: `frontend/src/modules/schedule/model.test.js`
  - Verify migration-aware experiment option generation
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.js`
  - Generate new task/sample/tray/experiment codes for edited and newly created data
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.test.js`
  - Verify new code generation and persistence consistency
- Modify: `frontend/src/modules/handover-system/page.vue`
  - Move experiment-type switcher into the header, default to task edit mode, and support click-task-number / click-blank to return
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`
  - Verify default edit mode, experiment-type switching, and return interactions
- Modify: `frontend/src/modules/handover-system/styles.css`
  - Keep current visual language while repositioning the experiment switch row

## Chunk 1: Snapshot And Identifier Migration

### Task 1: Add failing storage tests for `SYLU` migration and idempotence

**Files:**
- Modify: `tests/core/test_storage_backend.py`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- old task codes like `GDW-2024-005` migrate to `SYLU-2026-03-00N`
- sample, tray, experiment, schedule, and stream references are rewritten consistently
- repeated normalization keeps the same `SYLU` identifiers
- migrated payload receives `mes.meta.schema_version = 2`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/core/test_storage_backend.py -q
```

Expected: FAIL because storage normalization does not migrate old identifiers yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- schema-version metadata defaults
- deterministic task renumbering grouped by month
- reference rewrite maps for task/sample/tray/experiment/schedule/stream payloads
- idempotent normalization guard

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

### Task 2: Add failing MySQL mapping tests for migrated task and experiment numbers

**Files:**
- Modify: `tests/core/test_mysql_storage_backend.py`
- Modify: `app/core/mysql_storage_backend.py`
- Modify: `app/db/mysql_snapshot.py`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- old relational rows normalize to `SYLU` task codes
- `experiment_no` is regenerated from migrated `task_no`
- related rows preserve referential integrity after normalization

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/core/test_mysql_storage_backend.py -q
```

Expected: FAIL because MySQL mapping still assumes legacy task numbers.

- [ ] **Step 3: Write minimal implementation**

Implement:

- shared migration helpers for task / experiment / tray / schedule identifiers
- schema metadata persistence where appropriate
- migrated snapshot reads and writes from MySQL-backed storage

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 2: Historical Multi-Experiment Backfill

### Task 3: Backfill historical tasks with explicit experiment records

**Files:**
- Modify: `app/core/storage_backend.py`
- Modify: `app/data/mes_store.json`
- Modify: `tests/core/test_storage_backend.py`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- `GDW-2024-005`-style historical tasks become explicit dual-experiment tasks after migration
- tasks with `experiment_count` or legacy experiment hints backfill correctly
- true single-experiment tasks still get exactly one experiment

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/core/test_storage_backend.py -q
```

Expected: FAIL because historical backfill rules are not implemented.

- [ ] **Step 3: Write minimal implementation**

Implement:

- explicit backfill rules for historical multi-experiment tasks
- migrated seed data with full `mes.experiments` records
- deterministic experiment-code regeneration from migrated task codes

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 3: Task Code Generation For New And Edited Data

### Task 4: Update task editing code generation to emit `SYLU` identifiers

**Files:**
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.js`
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.test.js`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- new or edited task saves produce `SYLU-YYYY-MM-NNN`
- generated sample codes follow the migrated task code
- generated tray and experiment codes remain consistent with the new task number

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/task-overview/useTaskOverviewEditor.test.js
```

Expected: FAIL because editor-side code generation still assumes legacy prefixes.

- [ ] **Step 3: Write minimal implementation**

Implement:

- task-number generator based on task month and monthly sequence
- dependent sample / tray / experiment code regeneration from the new task code
- persistence updates that keep task-linked records aligned

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 4: Scheduling UI And Model

### Task 5: Make schedule experiment options consume migrated explicit experiments

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Modify: `frontend/src/modules/schedule/model.test.js`
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- historical migrated tasks expose the correct number of experiments
- experiment dropdown labels use experiment type text as the visible label
- full `experiment_code` remains available for selection and persistence

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/schedule/model.test.js
```

Expected: FAIL because schedule labels still default to `A实验 / B实验` or legacy fallback behavior.

- [ ] **Step 3: Write minimal implementation**

Implement:

- experiment options that display experiment type names
- tooltips / secondary text carrying full experiment codes
- removal of the single-default fallback for migrated historical multi-experiment tasks

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

### Task 6: Verify schedule page runtime for historical multi-experiment tasks

**Files:**
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`
- Modify: `frontend/src/modules/schedule/page.vue`

- [ ] **Step 1: Write the failing tests**

Add runtime coverage proving:

- migrated `GDW-2024-005` now exposes two experiments in the dropdown
- visible option text is experiment type, not `A实验 / B实验`
- task dropdown shows migrated `SYLU` task numbers

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/schedule/page.runtime.test.js
```

Expected: FAIL because runtime UI still reflects old task numbers and old experiment labels.

- [ ] **Step 3: Write minimal implementation**

Implement:

- migrated task labels in the schedule form
- experiment-type display text in the experiment dropdown
- full-code tooltip or helper text as needed

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 5: Handover Header And Experiment Switching

### Task 7: Update handover workspace payloads for migrated numbers and experiment summaries

**Files:**
- Modify: `app/api/routes/transfer_area.py`
- Modify: `tests/api/test_transfer_area.py`

- [ ] **Step 1: Write the failing tests**

Add coverage proving:

- bootstrap and workspace payloads return migrated task numbers
- workspace experiments include both visible experiment-type labels and full experiment codes
- historical multi-experiment tasks return the full experiment list

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/api/test_transfer_area.py -q
```

Expected: FAIL because transfer-area payloads still reflect old numbering or incomplete experiment data.

- [ ] **Step 3: Write minimal implementation**

Implement:

- migrated task code exposure in bootstrap/workspace
- experiment-type summary serialization
- backfilled experiment records included in workspace results

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

### Task 8: Move handover experiment switch row under task number and change interaction rules

**Files:**
- Modify: `frontend/src/modules/handover-system/page.vue`
- Modify: `frontend/src/modules/handover-system/styles.css`
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write the failing tests**

Add runtime coverage proving:

- detail view defaults to task tray editing without any explicit “任务托盘” button
- header first row shows only the task number
- second row shows experiment type items only
- clicking an experiment type enters experiment selection mode
- clicking the task number returns to default task edit mode
- clicking blank space clears experiment selection and returns to default mode

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js
```

Expected: FAIL because current handover view still uses explicit tabs and `A实验 / B实验`-style labels.

- [ ] **Step 3: Write minimal implementation**

Implement:

- header-first task-number row
- header-second experiment-type row with current visual language
- default task editing state on entry
- click-task-number and click-blank reset interactions
- tooltip/title binding for full experiment codes

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 6: Seed Data And Focused Regression

### Task 9: Refresh seed data and run cross-layer regression

**Files:**
- Modify: `app/data/mes_store.json`
- Test: `tests/core/test_storage_backend.py`
- Test: `tests/core/test_mysql_storage_backend.py`
- Test: `tests/api/test_transfer_area.py`
- Test: `frontend/src/modules/task-overview/useTaskOverviewEditor.test.js`
- Test: `frontend/src/modules/schedule/model.test.js`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Update seed data into migrated `SYLU` form**

Ensure:

- built-in demo data already uses `SYLU` task numbers
- historical multi-experiment examples are explicit
- task-linked sample / tray / experiment / schedule / stream references match

- [ ] **Step 2: Run the focused backend suite**

Run:

```bash
pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py tests/api/test_transfer_area.py -q
```

Expected: PASS

- [ ] **Step 3: Run the focused frontend suite**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/task-overview/useTaskOverviewEditor.test.js src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js src/modules/handover-system/page.runtime.test.js
```

Expected: PASS

- [ ] **Step 4: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no patch-format errors.

- [ ] **Step 5: Manual smoke verification**

Verify manually:

- a migrated historical task shows a `SYLU` task number
- the schedule page shows all experiments for that task
- the handover page defaults to tray edit mode
- clicking one experiment type switches into experiment selection
- clicking the task number or blank space returns to default edit mode
