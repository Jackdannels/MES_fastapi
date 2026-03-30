# Samples Pre-allocation Shared Transfer Workbench Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the old sample process area with a pre-allocation workbench that reuses the transfer-area workspace and keeps sample flow/staging panels intact.

**Architecture:** Extract the current handover workbench into a shared transfer workbench with mode-based configuration. Mount it in `handover-system` as the full handover mode and in `samples` as a pre-allocation mode that shares the same workspace data but hides formal storage actions.

**Tech Stack:** Vue 3, Vitest, Vite, CSS, existing transfer-area HTTP endpoints

---

## File Structure

### Existing files to modify

- `frontend/src/modules/handover-system/page.vue`
  Responsibility: current transfer-area screen and runtime logic; will be reduced to a mode-specific entry or wrapper around shared workbench logic.
- `frontend/src/modules/handover-system/page.runtime.test.js`
  Responsibility: runtime behavior coverage for overview/detail/allocation/printing/confirm/reload in handover mode.
- `frontend/src/modules/handover-system/styles.css`
  Responsibility: existing transfer-area look and responsive layout; reusable style home for shared workbench.
- `frontend/src/modules/samples/SamplesManagementPanel.vue`
  Responsibility: sample management composition; will replace the old `SampleProcessPanel` area with the shared pre-allocation workbench and remove lifecycle trace.
- `frontend/src/modules/samples/page.vue`
  Responsibility: page-level wiring; will remove `useSampleTrace` and old `useSamplesProcess` wiring.
- `frontend/src/modules/samples/index.js`
  Responsibility: module subtitle; may need wording update after removing lifecycle trace.
- `frontend/src/modules/samples/SamplesManagementPanel.structure.test.js`
  Responsibility: structure guard for top panel composition; will be updated to assert the new shared workbench mount and lifecycle trace removal.

### Candidate files to create

- `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
  Responsibility: shared overview/detail UI used by handover and samples modules.
- `frontend/src/modules/transfer-workbench/useTransferWorkbench.js`
  Responsibility: shared state, loading, filtering, tray editing, saving, printing, mode-specific action gating.
- `frontend/src/modules/transfer-workbench/modes.js`
  Responsibility: mode config for `handover` and `pre-allocation` labels, action visibility, help text, and read-only rules.
- `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
  Responsibility: shared behavior tests for mode differences, filter cards, read-only handling, and workspace sync expectations.

### Candidate files to retire

- `frontend/src/modules/samples/SampleProcessPanel.vue`
- `frontend/src/modules/samples/useSamplesProcess.js`
- `frontend/src/modules/samples/samplesProcessModel.js`

Retirement should happen only after the shared workbench fully replaces the old top area and tests cover the new path.

## Chunk 1: Shared Workbench Extraction

### Task 1: Lock shared workbench extraction with failing structure/runtime tests

**Files:**
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`
- Add: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

- [ ] **Step 1: Write a failing shared-workbench runtime test for the default overview -> detail flow**

```js
test("shared workbench loads overview and opens workspace detail", async () => {
  // Mount shared workbench in handover mode.
  // Expect overview cards and detail workspace to render from the existing transfer endpoints.
});
```

- [ ] **Step 2: Run the failing tests**

Run: `npm run test:run -- src/modules/handover-system/page.runtime.test.js src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

Expected: `FAIL` because the shared module does not exist yet.

- [ ] **Step 3: Extract minimal shared workbench component and shared composition logic**

Create:
- `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`
- `frontend/src/modules/transfer-workbench/useTransferWorkbench.js`

Modify:
- `frontend/src/modules/handover-system/page.vue`

- [ ] **Step 4: Run the same tests to verify handover behavior still passes through the shared path**

Run: `npm run test:run -- src/modules/handover-system/page.runtime.test.js src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

Expected: `PASS`

## Chunk 2: Pre-allocation Mode

### Task 2: Add failing tests for pre-allocation mode behavior

**Files:**
- Add: `frontend/src/modules/transfer-workbench/modes.js`
- Add: `frontend/src/modules/samples/preAllocation.runtime.test.js`
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

- [ ] **Step 1: Write failing tests for pre-allocation mode**

Required expectations:
- Title is `样品预分装`
- Default filter is `未入库`
- Filter cards are clickable and show counts
- `确认入库` is hidden
- `重新入库` label becomes `重新分配`
- `打印条形码` and `保存托盘` remain available
- Stored tasks are read-only but printable

- [ ] **Step 2: Run the failing tests**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/samples/preAllocation.runtime.test.js`

Expected: `FAIL` on missing mode config and wrong action set.

- [ ] **Step 3: Implement mode config and wire samples module to the shared workbench**

Create:
- `frontend/src/modules/transfer-workbench/modes.js`

Modify:
- `frontend/src/modules/samples/SamplesManagementPanel.vue`
- `frontend/src/modules/samples/page.vue`

- [ ] **Step 4: Run the same tests to verify pre-allocation mode behavior**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/samples/preAllocation.runtime.test.js`

Expected: `PASS`

## Chunk 3: Samples Page Cleanup

### Task 3: Remove lifecycle trace and old top-panel wiring

**Files:**
- Modify: `frontend/src/modules/samples/SamplesManagementPanel.vue`
- Modify: `frontend/src/modules/samples/page.vue`
- Modify: `frontend/src/modules/samples/SamplesManagementPanel.structure.test.js`

- [ ] **Step 1: Write failing structure tests**

Required assertions:
- `SampleProcessPanel` no longer renders in the management panel
- `样品全生命周期追踪` no longer appears
- `样品流转与状态` still appears
- `暂存间派发` still appears

- [ ] **Step 2: Run the failing structure test**

Run: `npm run test:run -- src/modules/samples/SamplesManagementPanel.structure.test.js`

Expected: `FAIL`

- [ ] **Step 3: Remove old trace/process panel wiring and mount the pre-allocation workbench**

Modify:
- `frontend/src/modules/samples/SamplesManagementPanel.vue`
- `frontend/src/modules/samples/page.vue`

- [ ] **Step 4: Re-run the structure test**

Run: `npm run test:run -- src/modules/samples/SamplesManagementPanel.structure.test.js`

Expected: `PASS`

## Chunk 4: Old Process Stack Retirement

### Task 4: Remove obsolete sample-process implementation if no longer referenced

**Files:**
- Delete: `frontend/src/modules/samples/SampleProcessPanel.vue`
- Delete: `frontend/src/modules/samples/useSamplesProcess.js`
- Delete: `frontend/src/modules/samples/samplesProcessModel.js`
- Modify: any tests that still import these files

- [ ] **Step 1: Search remaining references and write failing cleanup expectations if needed**

Run: `rg -n "SampleProcessPanel|useSamplesProcess|samplesProcessModel" frontend/src`

- [ ] **Step 2: Delete obsolete files only after references are gone**

- [ ] **Step 3: Run targeted tests for samples and handover modules**

Run: `npm run test:run -- src/modules/handover-system/page.runtime.test.js src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/samples/SamplesManagementPanel.structure.test.js src/modules/samples/preAllocation.runtime.test.js`

Expected: `PASS`

## Chunk 5: Styling and Final Verification

### Task 5: Align pre-allocation visuals with process-control style cards

**Files:**
- Modify: `frontend/src/modules/handover-system/styles.css`
- Modify: shared transfer-workbench component/style bindings

- [ ] **Step 1: Add clickable KPI filter cards for `未入库 / 已入库 / 全部`**

- [ ] **Step 2: Preserve handover layout while updating the samples pre-allocation header and helper text**

- [ ] **Step 3: Run full targeted verification**

Run: `npm run test:run -- src/modules/handover-system/page.runtime.test.js src/modules/transfer-workbench/TransferWorkbench.runtime.test.js src/modules/samples/SamplesManagementPanel.structure.test.js src/modules/samples/preAllocation.runtime.test.js src/modules/samples/page.runtime.test.js`

Expected: `PASS`

- [ ] **Step 4: Record residual risks**

Residual risks to note if not manually verified:
- visual spacing between shared workbench and existing samples subpanels
- read-only affordance clarity for stored tasks in pre-allocation mode
- barcode print flow parity after component extraction
