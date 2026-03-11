# Process Task Code-First Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make task code the primary visual headline in the process task modal.

**Architecture:** Restrict the change to the modal hero presentation in `ProcessPage.vue` and cover it with a runtime test. No data-flow changes are needed.

**Tech Stack:** Vue 3, Vitest

---

### Task 1: Enforce code-first hero semantics

**Files:**
- Modify: `frontend/src/pages/ProcessPage.vue`
- Test: `frontend/src/pages/ProcessPage.runtime.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `cd frontend && npm run test:run -- src/pages/ProcessPage.runtime.test.js`**
- [ ] **Step 3: Implement the code-first hero markup and typography**
- [ ] **Step 4: Re-run the same test until it passes**

### Task 2: Verify frontend

**Files:**
- Verify only

- [ ] **Step 1: Run `cd frontend && npm run test:run -- src/pages/ProcessPage.runtime.test.js`**
- [ ] **Step 2: Run `cd frontend && npm run test:run`**
- [ ] **Step 3: Run `cd frontend && npm run build`**
