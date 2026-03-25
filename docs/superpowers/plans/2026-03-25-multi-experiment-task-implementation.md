# Multi-Experiment Task Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the system from “one task equals one experiment” to “one task contains multiple experiments”, so scheduling works per experiment and the handover system supports task-level tray editing plus experiment-level tray selection.

**Architecture:** Introduce explicit experiment entities and experiment-tray associations while keeping samples and trays task-owned. Persist the new model in both JSON storage and MySQL mapping, drive scheduling with `task_code + experiment_code`, and change the handover UI to operate on frontend drafts that are saved in one transaction after all experiments are assigned.

**Tech Stack:** FastAPI, Vue 3, existing storage backends, MySQL mapping layer, Vitest, pytest

---

## File Structure

- Modify: `app/core/storage_backend.py`
  - Add new storage keys for experiments and experiment-tray relations
- Modify: `app/core/mysql_storage_backend.py`
  - Add experiment relational mapping, schedule `experiment_no` support, table/column bootstrap helpers, and read/write round trips
- Modify: `app/db/mysql_snapshot.py`
  - Keep snapshot bootstrap compatible if new snapshot keys are introduced
- Modify: `app/api/routes/transfer_area.py`
  - Change handover APIs from task-only workspace to task + experiments + experiment-tray draft/save model
- Modify: `app/data/mes_store.json`
  - Add seed experiments and experiment-tray demo data
- Modify: `tests/core/test_storage_backend.py`
  - Cover new storage keys defaulting and JSON normalization
- Modify: `tests/core/test_mysql_storage_backend.py`
  - Cover experiment and schedule round trips
- Modify: `tests/api/test_transfer_area.py`
  - Cover multi-experiment handover bootstrap, workspace, save, reset, and print behavior
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.js`
  - Support task-level experiment editing and persistence
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.test.js`
  - Cover editing task experiments and derived summaries
- Modify: `frontend/src/modules/task-overview/TaskOverviewEditorPanel.vue`
  - Add experiment list editing UI
- Modify: `frontend/src/modules/task-overview/model.js`
  - Show experiment summaries in task overview rows
- Modify: `frontend/src/modules/task-overview/model.test.js`
  - Cover experiment counts and summaries
- Modify: `frontend/src/modules/schedule/model.js`
  - Build experiment-level scheduling rows, forms, status aggregation, and conflict logic
- Modify: `frontend/src/modules/schedule/model.test.js`
  - Cover multi-experiment scheduling behavior
- Modify: `frontend/src/modules/schedule/page.vue`
  - Render experiment fields in scheduling tables/forms
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`
  - Verify experiment-level scheduling UI
- Modify: `frontend/src/modules/handover-system/page.vue`
  - Add task tray mode, experiment tabs, draft cache, unified save, and label printing support
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`
  - Cover task-mode editing, experiment-mode selection, draft reset, save gating, and print gating
- Modify: `frontend/src/lib/tasksApi.js`
  - Extend task payload shape if task editing is API-backed
- Modify: `frontend/src/lib/tasksApi.test.js`
  - Cover experiment fields if exposed there

## Chunk 1: Storage Foundation

### Task 1: Add experiment storage keys and JSON defaults

**Files:**
- Modify: `app/core/storage_backend.py`
- Modify: `tests/core/test_storage_backend.py`
- Modify: `app/data/mes_store.json`

- [ ] **Step 1: Write the failing tests**

Add coverage proving:

- `mes.experiments` and `mes.experiment_trays` exist in default storage payloads
- JSON normalization fills missing keys without corrupting existing data

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/core/test_storage_backend.py -q
```

Expected: FAIL because the new storage keys do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- new storage keys in `STORAGE_KEYS`
- default empty arrays for new collections
- sample seed data in `app/data/mes_store.json` with at least one task containing multiple experiments

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

### Task 2: Add MySQL experiment mapping and schema bootstrap helpers

**Files:**
- Modify: `app/core/mysql_storage_backend.py`
- Modify: `app/db/mysql_snapshot.py`
- Modify: `tests/core/test_mysql_storage_backend.py`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- experiment row round-trip between frontend payload and MySQL mapping
- schedule row round-trip preserving `experiment_code`
- experiment-tray relation mapping helpers

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/core/test_mysql_storage_backend.py -q
```

Expected: FAIL because experiment mapping and schedule experiment support do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- MySQL helper functions for `biz_experiment` and `biz_experiment_tray`
- `biz_schedule.experiment_no` read/write support
- bootstrap SQL helpers to create the new relation table and add missing columns/indexes if absent

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 2: Task Definition And Experiment Summaries

### Task 3: Extend task editing to manage experiments

**Files:**
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.js`
- Modify: `frontend/src/modules/task-overview/useTaskOverviewEditor.test.js`
- Modify: `frontend/src/modules/task-overview/TaskOverviewEditorPanel.vue`

- [ ] **Step 1: Write the failing tests**

Add coverage proving:

- one task can save multiple experiments
- experiment numbers are generated/stored with the task
- removing an experiment removes its persisted relation data from the local snapshot payload

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/task-overview/useTaskOverviewEditor.test.js
```

Expected: FAIL because the editor only supports one task-level experiment today.

- [ ] **Step 3: Write minimal implementation**

Implement:

- experiment list editing state in the task editor
- task save flow that writes `mes.experiments`
- generated experiment codes based on task code suffixes

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

### Task 4: Show experiment summaries in task overview rows

**Files:**
- Modify: `frontend/src/modules/task-overview/model.js`
- Modify: `frontend/src/modules/task-overview/model.test.js`

- [ ] **Step 1: Write the failing tests**

Add coverage proving:

- task overview rows expose experiment count
- task overview rows expose experiment summary labels instead of a single misleading test type

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/task-overview/model.test.js
```

Expected: FAIL because overview rows still assume one task equals one experiment.

- [ ] **Step 3: Write minimal implementation**

Implement:

- experiment summary derivation from `mes.experiments`
- task row fields for experiment count and concise summary text

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 3: Experiment-Level Scheduling

### Task 5: Convert scheduling model from task rows to experiment rows

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Modify: `frontend/src/modules/schedule/model.test.js`

- [ ] **Step 1: Write the failing tests**

Add coverage proving:

- scheduling rows are built per `experiment_code`
- the same task can produce multiple independently schedulable rows
- create/update/delete schedule operations preserve `task_code` and `experiment_code`
- task-level status aggregation still works from child experiment schedules

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/schedule/model.test.js
```

Expected: FAIL because scheduling still keys everything by `task_code` only.

- [ ] **Step 3: Write minimal implementation**

Implement:

- experiment-level schedule rows and forms
- conflict checks keyed by device + time but carrying `experiment_code`
- task aggregate status derivation from experiment schedule states

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

### Task 6: Update scheduling page UI to expose experiment fields

**Files:**
- Modify: `frontend/src/modules/schedule/page.vue`
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: Write the failing tests**

Add coverage proving:

- pending list renders task number and experiment number
- schedule forms and tables show experiment fields

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/schedule/page.runtime.test.js
```

Expected: FAIL because the page does not render experiment-aware fields yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- experiment columns in the scheduling list/table
- experiment-aware labels in create/edit forms and gantt blocks

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 4: Handover Backend

### Task 7: Extend handover APIs with experiments, experiment trays, and unified save

**Files:**
- Modify: `app/api/routes/transfer_area.py`
- Modify: `tests/api/test_transfer_area.py`

- [ ] **Step 1: Write the failing tests**

Add coverage proving:

- bootstrap returns task-level experiment summaries
- workspace returns task tray data plus experiment tabs and experiment-tray selections
- unified save writes task tray layout and all experiment-tray assignments together
- changing task tray structure clears experiment assignments in the returned workspace
- printing payload includes tray labels for experiments while barcode value remains tray-only

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pytest tests/api/test_transfer_area.py -q
```

Expected: FAIL because the API only supports task-only tray allocation.

- [ ] **Step 3: Write minimal implementation**

Implement:

- experiment serialization for handover bootstrap/workspace
- draft-save payload model carrying both trays and `experimentTrays`
- reset logic that clears persisted experiment-tray rows when the saved task tray structure changes
- print response fields that include experiment labels per tray

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 5: Handover Frontend

### Task 8: Add task tray mode and experiment selection mode with frontend drafts

**Files:**
- Modify: `frontend/src/modules/handover-system/page.vue`
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write the failing tests**

Add coverage proving:

- task mode allows tray edits
- experiment mode disables tray structure editing and only toggles tray selection
- task tray draft changes clear experiment selections in the UI
- save button stays disabled until every experiment has at least one selected tray
- print button stays disabled until the unified save succeeds

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js
```

Expected: FAIL because the current page only has one task-only editable mode.

- [ ] **Step 3: Write minimal implementation**

Implement:

- task/experiment tab state
- draft tray layout cache
- draft experiment-tray selection cache
- visual tray labels showing assigned experiments
- unified save action and post-save print gating

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 6: Focused Regression

### Task 9: Run the cross-layer regression suite

**Files:**
- Test: `tests/core/test_storage_backend.py`
- Test: `tests/core/test_mysql_storage_backend.py`
- Test: `tests/api/test_transfer_area.py`
- Test: `frontend/src/modules/task-overview/useTaskOverviewEditor.test.js`
- Test: `frontend/src/modules/task-overview/model.test.js`
- Test: `frontend/src/modules/schedule/model.test.js`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Run the focused backend suite**

Run:

```bash
pytest tests/core/test_storage_backend.py tests/core/test_mysql_storage_backend.py tests/api/test_transfer_area.py -q
```

Expected: PASS

- [ ] **Step 2: Run the focused frontend suite**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/task-overview/useTaskOverviewEditor.test.js src/modules/task-overview/model.test.js src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js src/modules/handover-system/page.runtime.test.js
```

Expected: PASS

- [ ] **Step 3: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no patch-format errors.

- [ ] **Step 4: Run one manual smoke path**

Verify manually:

- create or edit one task with multiple experiments
- schedule two experiments from the same task separately
- enter handover task mode and distribute trays
- switch to experiment tabs and select trays
- save once, then print tray labels with experiment tags
