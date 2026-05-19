# Laboratory Current Experiment Withdrawal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the laboratory "重置当前实验任务" flow into a scoped withdrawal that restores the current experiment trays to the previous valid dispatch origin: `到货`, `已到达暂存间`, or the previous completed experiment.

**Architecture:** Keep experiment assignment and schedules immutable. Add a backend laboratory withdrawal API that reads the storage snapshot, CAS-checks current tray statuses, restores only current experiment tray/sample projection fields, appends audit history, and appends staging compensation events when returning to staging. Update the laboratory UI to call the API, and update tray flow history cutoff logic so withdrawn mistaken lab steps no longer appear as valid progress.

**Tech Stack:** FastAPI, existing storage backend snapshot API, Vue 3 Composition API, Vitest, pytest.

---

## Chunk 1: Backend Withdrawal API

### Task 1: Add route and tests for laboratory scoped withdrawal

**Files:**
- Create/Modify: `app/api/routes/laboratory.py`
- Modify: `app/modules/registry.py`
- Test: `tests/api/test_laboratory.py`

- [ ] Write failing backend tests covering:
  - current lab installed/ready tray returns to `到货` when the previous origin is handover;
  - current lab installed/ready tray returns to `已到达暂存间` and appends `stock_out_withdraw` when the previous origin is staging;
  - current lab mistaken B experiment after A completion returns to `实验已完成` and keeps A completion history valid;
  - reject `实验进行中`, current experiment `实验已完成`, `放置实验后暂存间`, and `厂家收回`.
- [ ] Implement `POST /api/laboratory/tasks/{task_code}/experiments/{experiment_code}/withdraw-current`.
- [ ] Scope affected trays through `mes.experiment_trays` for `task_code + experiment_code`.
- [ ] CAS-check all matching tray statuses are only `已到达实验室`, `工装夹具安装`, or `实验准备就绪`.
- [ ] Resolve restore target from newest valid history:
  - staging-origin outflow -> `已到达暂存间`, `恒温恒湿间（暂存间）`;
  - handover-origin outflow -> `到货`, `接驳区`;
  - previous completed experiment -> `实验已完成`, keep current sample location from previous completion if available.
- [ ] Update only `mes.samples` projection fields and matching `trays[]`, clearing `fixture_ready`/`fixtureReady`.
- [ ] Append `实验任务撤回` history; append `stock_out_withdraw` to `mes.staging_events` only when restoring to staging.
- [ ] Do not modify `mes.tasks`, `mes.experiment_trays`, `mes.experiment_samples`, `mes.schedules`, or `mes.experiments`.

## Chunk 2: Frontend Laboratory Integration

### Task 2: Replace reset call with backend withdrawal call

**Files:**
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Modify: `frontend/src/modules/laboratory/page.vue`
- Test: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] Add API helper for the new laboratory withdrawal route.
- [ ] Rename user-facing button/copy from reset to withdrawal semantics while preserving test ids where practical.
- [ ] Keep double confirmation, but mention the operation restores to the previous dispatch origin and only affects current experiment trays.
- [ ] On confirm, call backend API, then refresh/read updated storage snapshot or merge returned arrays.
- [ ] Keep existing disable rules for running/completed states, and verify the button is available for `已到达实验室`, `工装夹具安装`, `实验准备就绪`.

## Chunk 3: Flow Cutoff

### Task 3: Extend tray flow history cutoff for experiment withdrawal

**Files:**
- Modify: `frontend/src/modules/samples/samplesFlowModel.js`
- Test: `frontend/src/modules/samples/samplesFlowModel.test.js`

- [ ] Generalize existing `撤回出库` cutoff to include `实验任务撤回` and `任务切换撤回`.
- [ ] Apply cutoff filtering to both normal flow label time mapping and experiment event derivation.
- [ ] Add tests:
  - restoring to `到货` hides old staging/lab/experiment times;
  - restoring to `已到达暂存间` hides old lab/experiment times;
  - restoring to `A实验已完成` keeps A completion active and hides mistaken B installation/ready/running history;
  - later valid dispatch after withdrawal still appears normally.

## Chunk 4: Verification and Cross Review

### Task 4: Run targeted and regression checks

**Files:**
- Verify: `tests/api/test_laboratory.py`
- Verify: `frontend/src/modules/laboratory/page.runtime.test.js`
- Verify: `frontend/src/modules/laboratory/model.test.js`
- Verify: `frontend/src/modules/samples/samplesFlowModel.test.js`
- Verify: `frontend/src/modules/samples/TrayManagementPanel.test.js`

- [ ] Run backend tests for the new API.
- [ ] Run laboratory runtime and model tests.
- [ ] Run samples flow tests.
- [ ] Ask cross-validation agents to inspect implementation for staging event divergence, cross-experiment contamination, and flow history leakage.
- [ ] Fix any issues and rerun tests.
