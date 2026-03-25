# Staging Overview Tray Rows Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the staging-system information list from sample-based rows to tray-based rows so each tray occupies one row and the list shows task numbers and tray numbers instead of sample numbers.

**Architecture:** Keep the staging module isolated. Update the static overview dataset and view-model helpers in `staging-management/model.js`, then update `page.vue` labels, search placeholder, table columns, and runtime tests to match the new tray-based semantics.

**Tech Stack:** Vue 3, Vitest, Vue Test Utils

---

### Task 1: Lock tray-based behavior in tests

**Files:**
- Modify: `frontend/src/modules/staging-management/model.test.js`
- Modify: `frontend/src/modules/staging-management/page.runtime.test.js`

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Verify the old sample-based assumptions are no longer valid**

### Task 2: Convert staging overview data and list rendering

**Files:**
- Modify: `frontend/src/modules/staging-management/model.js`
- Modify: `frontend/src/modules/staging-management/page.vue`

- [ ] **Step 1: Replace sample-code rows with tray-code rows**
- [ ] **Step 2: Update search/sort/list labels from sample to tray semantics**

### Task 3: Verify syntax and key expectations

**Files:**
- Verify: `frontend/src/modules/staging-management/model.js`
- Verify: `frontend/src/modules/staging-management/page.vue`

- [ ] **Step 1: Run focused verification**
