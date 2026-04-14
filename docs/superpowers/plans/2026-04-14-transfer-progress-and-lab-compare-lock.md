# Transfer Progress And Lab Compare Lock Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make transfer-area task progress stay at `实验进行中` until all experiments are complete, and make the laboratory console lock compare/install after the first install while keeping ready promotion scoped to installed trays only.

**Architecture:** Keep the transfer-area summary rule in the backend route serializer so every caller gets consistent progress text. Keep the laboratory lock rule inside the workflow model so button enablement and progress messaging stay derived from tray status instead of ad-hoc UI flags, and keep tray filtering inside the page action persistence helper so repeated clicks cannot promote the wrong trays.

**Tech Stack:** FastAPI, Python, Vue 3, Vitest, pytest

---

## Chunk 1: Transfer-Area Progress Summary

### Task 1: Add backend regression coverage

**Files:**
- Modify: `tests/api/test_transfer_area.py`
- Modify: `app/api/routes/transfer_area.py`

- [ ] **Step 1: Write the failing test**

Add a bootstrap/workspace test where one experiment is complete but sibling experiments are not, and assert `taskProgress == "实验进行中"`.

- [ ] **Step 2: Run test to verify it fails**

Run: `C:\Users\12051\Desktop\MES_fastapi\.venv\Scripts\python.exe -m pytest tests\api\test_transfer_area.py -k progress -q`
Expected: FAIL because progress still resolves to `实验已完成`.

- [ ] **Step 3: Write minimal implementation**

Update `app/api/routes/transfer_area.py` so `task_progress(...)` only returns a completed-like state when every experiment row under the task is completed.

- [ ] **Step 4: Run test to verify it passes**

Run: `C:\Users\12051\Desktop\MES_fastapi\.venv\Scripts\python.exe -m pytest tests\api\test_transfer_area.py -k progress -q`
Expected: PASS

## Chunk 2: Laboratory Compare Lock

### Task 2: Add workflow-model regression coverage

**Files:**
- Modify: `frontend/src/modules/laboratory/model.test.js`
- Modify: `frontend/src/modules/laboratory/model.js`

- [ ] **Step 1: Write the failing test**

Add a model test showing:
- partial compare without install keeps `canCompare: true`
- any installed tray forces `canCompare: false`
- any installed tray also forces `canInstallSample: false`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/laboratory/model.test.js`
Expected: FAIL because installed trays still permit compare.

- [ ] **Step 3: Write minimal implementation**

Update `getLaboratoryActionState()` to lock both compare and install when installation has started.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/laboratory/model.test.js`
Expected: PASS

### Task 3: Add runtime regression coverage

**Files:**
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`

- [ ] **Step 1: Write the failing test**

Extend the persisted progress runtime test to assert:
- compare remains enabled after partial compare
- compare becomes disabled immediately after install
- install becomes disabled immediately after install
- ready promotion only upgrades trays that are already at `工装夹具安装`

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: FAIL because compare button remains enabled after install.

- [ ] **Step 3: Write minimal implementation**

Keep the runtime behavior derived from the workflow model and tighten `persistCurrentTaskStep()` so:
- install targets only `已到达实验室` trays
- ready targets only `工装夹具安装` trays

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: PASS

## Chunk 3: Final Verification

### Task 4: Run focused regression suites

**Files:**
- Verify only

- [ ] **Step 1: Run backend focused regression**

Run: `C:\Users\12051\Desktop\MES_fastapi\.venv\Scripts\python.exe -m pytest tests\api\test_transfer_area.py -q`
Expected: PASS

- [ ] **Step 2: Run frontend focused regression**

Run: `npm run test:run -- src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js`
Expected: PASS

- [ ] **Step 3: Review diff**

Run: `git diff --stat`
Expected: only transfer-area, laboratory, and plan/spec docs changed.
