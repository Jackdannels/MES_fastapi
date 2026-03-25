# Task Arrival Time From Sample Store Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task arrival time come only from sample-store confirmation and remain blank before confirmation.

**Architecture:** Keep the business rule inside the sample process model and remove manual `arrival_at` writes from task form helpers. The task UI will show the field as read-only so the displayed value remains visible but cannot be manually set.

**Tech Stack:** Vue 3, existing task/sample models, Vitest

---

## Chunk 1: Business Rule Tests

### Task 1: Add failing tests for task arrival timestamp ownership

**Files:**
- Modify: `frontend/src/modules/samples/samplesProcessModel.test.js`
- Modify: `frontend/src/modules/tasks/model.test.js`
- Modify: `frontend/src/modules/tasks/page.runtime.test.js`

- [ ] **Step 1: Write a failing sample-process test that confirm store writes `task.arrival_at`**
- [ ] **Step 2: Write a failing sample-process test that re-store overwrites `task.arrival_at`**
- [ ] **Step 3: Write a failing task-model test that task create/update ignore manual `arrival_at`**
- [ ] **Step 4: Write a failing task-page runtime test that the arrival field is read-only**
- [ ] **Step 5: Run the focused Vitest command and confirm the tests fail for the expected reason**

## Chunk 2: Minimal Implementation

### Task 2: Implement arrival-time ownership in the sample process model

**Files:**
- Modify: `frontend/src/modules/samples/samplesProcessModel.js`

- [ ] **Step 1: On confirm store, set matching task `arrival_at` to the confirmation timestamp**
- [ ] **Step 2: Preserve overwrite behavior by always using the latest confirm-store time**
- [ ] **Step 3: Keep unrelated task/sample behaviors unchanged**

### Task 3: Remove manual task-form ownership of `arrival_at`

**Files:**
- Modify: `frontend/src/modules/tasks/model.js`
- Modify: `frontend/src/modules/tasks/page.vue`

- [ ] **Step 1: Stop task create/update helpers from persisting user-entered `arrival_at`**
- [ ] **Step 2: Keep form structure stable but make the field read-only with an explanatory helper**
- [ ] **Step 3: Ensure existing task display formatting still works when `arrival_at` is blank**

## Chunk 3: Verification and User Checkpoint

### Task 4: Run focused verification and stop for manual checks

**Files:**
- Modify: touched files as needed

- [ ] **Step 1: Run `npm --prefix frontend run test:run -- src/modules/samples/samplesProcessModel.test.js src/modules/tasks/model.test.js src/modules/tasks/page.runtime.test.js`**
- [ ] **Step 2: Run `git diff --check` on the touched files**
- [ ] **Step 3: Give the user explicit task-page and sample-store manual verification steps**
