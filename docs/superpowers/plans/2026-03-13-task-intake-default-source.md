# Task Intake Default Source Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make all manually created tasks default to `内部新增` when the intake modal opens.

**Architecture:** Keep the change scoped to the task intake form factory in `tasksPageModel`, because that is the single source of truth for the modal's initial state. Verify the behavior through `TasksPage` runtime tests so the UI default and persistence path are both covered without changing edit behavior or existing records.

**Tech Stack:** Vue 3, Vitest, Vite

---

### Task 1: Change intake default source

**Files:**
- Modify: `frontend/src/lib/tasksPageModel.js`
- Test: `frontend/src/pages/TasksPage.runtime.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run test to verify it fails**
- [ ] **Step 3: Write minimal implementation**
- [ ] **Step 4: Run tests to verify they pass**
