# Schedule Legacy Parity Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `排程看板` legacy-equivalent linkage and gantt presentation while keeping the Vue 3 implementation.

**Architecture:** Keep the page Vue-native, but move missing legacy scheduling rules into `schedulePageModel` and `useSchedulePage` so the UI becomes a thin binding layer again. Reuse the existing gantt CSS contract by aligning the Vue template’s DOM/class structure with the legacy renderer instead of adding parallel styles.

**Tech Stack:** Vue 3, Vitest, Vite

---

### Task 1: Lock missing legacy parity behaviors with tests

**Files:**
- Modify: `frontend/src/pages/SchedulePage.runtime.test.js`
- Modify: `frontend/src/lib/schedulePageModel.test.js`

- [ ] **Step 1: Write failing tests for task→lab linkage, lab→gantt filtering, retention timing, and gantt class contract**
- [ ] **Step 2: Run targeted tests to verify they fail**
- [ ] **Step 3: Implement the minimal parity logic**
- [ ] **Step 4: Re-run targeted tests to verify they pass**

### Task 2: Restore page linkage and gantt DOM contract

**Files:**
- Modify: `frontend/src/lib/schedulePageModel.js`
- Modify: `frontend/src/composables/useSchedulePage.js`
- Modify: `frontend/src/pages/SchedulePage.vue`

- [ ] **Step 1: Preserve legacy task candidate and lab option rules**
- [ ] **Step 2: Restore gantt filtering from selected lab and retention time locking**
- [ ] **Step 3: Align gantt slot DOM/classes with existing CSS**
- [ ] **Step 4: Verify schedule CRUD still works**

### Task 3: Run regression verification

**Files:**
- Verify: `frontend/src/pages/SchedulePage.runtime.test.js`
- Verify: `frontend/src/lib/schedulePageModel.test.js`
- Verify: `frontend/src/App.runtime.test.js`
- Verify: `frontend/src/lib/appConfig.test.js`
- Verify: `frontend/src/router/index.structure.test.js`

- [ ] **Step 1: Run schedule-focused regression tests**
- [ ] **Step 2: Run broader migrated-page regression tests**
- [ ] **Step 3: Run `npm run build`**
