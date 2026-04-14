# Schedule Slot Start Window Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make fixed schedule slots use the earliest legal start time instead of a hard-coded window start, while surfacing that start time in the UI.

**Architecture:** Concentrate the business rule in `frontend/src/modules/schedule/model.js`, then expose derived slot labels through `useSchedulePage` into `page.vue`. Protect the rule with model-level tests first, then runtime tests for the visible labels.

**Tech Stack:** Vue 3, Vitest, existing schedule page model/runtime tests

---

## Chunk 1: Model Rules

### Task 1: Add failing model tests for fixed-slot earliest-start behavior

**Files:**
- Modify: `frontend/src/modules/schedule/model.test.js`
- Modify: `frontend/src/modules/schedule/model.js`

- [ ] **Step 1: Write failing tests for morning/afternoon slot earliest-start rules**
- [ ] **Step 2: Run `npm run test:run -- src/modules/schedule/model.test.js` and confirm failure**
- [ ] **Step 3: Implement minimal helpers for earliest start and dynamic slot labels**
- [ ] **Step 4: Re-run `npm run test:run -- src/modules/schedule/model.test.js` and confirm pass**

## Chunk 2: Page Wiring

### Task 2: Surface dynamic slot labels in the manual schedule form

**Files:**
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Modify: `frontend/src/modules/schedule/page.vue`
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: Write failing runtime test for visible slot label showing the earliest start time**
- [ ] **Step 2: Run `npm run test:run -- src/modules/schedule/page.runtime.test.js` and confirm failure**
- [ ] **Step 3: Wire computed slot options from `useSchedulePage` into `page.vue`**
- [ ] **Step 4: Re-run `npm run test:run -- src/modules/schedule/page.runtime.test.js` and confirm pass**

## Chunk 3: Regression Verification

### Task 3: Verify the schedule module and dependent flows stay green

**Files:**
- Verify only

- [ ] **Step 1: Run `npm run test:run -- src/modules/schedule/model.test.js src/modules/schedule/page.runtime.test.js src/modules/schedule/useSchedulePage.test.js`**
- [ ] **Step 2: Run `npm run test:run -- src/lib/storageApi.test.js src/lib/tasksApi.test.js src/modules/samples/page.runtime.test.js src/modules/tasks/page.runtime.test.js src/modules/schedule/page.runtime.test.js`**
- [ ] **Step 3: Commit with a message describing the schedule-slot rule update**
