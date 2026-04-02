# Transfer Workbench Readonly Lock Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock tray allocation editing after save in both pre-allocation and handover workbenches until the operator explicitly resets the workspace.

**Architecture:** Extend the shared transfer workbench lock model so `allocationSaved` becomes a first-class readonly condition. Cover the behavior with runtime tests in the two pages that embed the shared workbench.

**Tech Stack:** Vue 3, Vue Test Utils, Vitest

---

## Chunk 1: Runtime Coverage

### Task 1: Pre-allocation readonly regression test

**Files:**
- Modify: `frontend/src/modules/samples/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `npm run test:run -- src/modules/samples/page.runtime.test.js -t "pre-allocation becomes read-only after saving until reallocate is clicked"` and verify it fails**
- [ ] **Step 3: Assert saved state disables add/remove/drag and reset restores editing**
- [ ] **Step 4: Re-run the targeted test and verify it passes**

### Task 2: Handover readonly regression test

**Files:**
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `npm run test:run -- src/modules/handover-system/page.runtime.test.js -t "handover allocation becomes read-only after saving until re-entry is clicked"` and verify it fails**
- [ ] **Step 3: Assert saved state blocks add/move and reset restores editing**
- [ ] **Step 4: Re-run the targeted test and verify it passes**

## Chunk 2: Shared Workbench Lock

### Task 3: Promote saved allocation to readonly state

**Files:**
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`

- [ ] **Step 1: Introduce a dedicated readonly computed based on `allocationSaved` and stored-task state**
- [ ] **Step 2: Apply that lock to drag, click-move, tray creation/deletion, tray limit controls, and experiment tray toggles**
- [ ] **Step 3: Keep reset and print flows available**
- [ ] **Step 4: Re-run the two targeted tests and verify they pass**

## Chunk 3: Verification

### Task 4: Run focused regression suite

**Files:**
- Verify: `frontend/src/modules/samples/page.runtime.test.js`
- Verify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Run `npm run test:run -- src/modules/samples/page.runtime.test.js src/modules/handover-system/page.runtime.test.js`**
- [ ] **Step 2: Run `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.vue` only if a dedicated runtime suite exists; otherwise skip**
- [ ] **Step 3: Record the verification command and outcome**
