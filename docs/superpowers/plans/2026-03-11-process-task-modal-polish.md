# Process Task Modal Polish Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the process-page task modal so it feels more distinctive and hides batch suffixes in the displayed task name.

**Architecture:** Keep the data logic in `useProcessLabs()` and keep `ProcessPage.vue` focused on rendering. Add a small display-name sanitizer plus richer tray presentation, but do not mutate the stored task data.

**Tech Stack:** Vue 3, Vitest, existing app CSS

---

### Task 1: Add display-name sanitization and richer tray metadata

**Files:**
- Modify: `frontend/src/composables/useProcessLabs.js`
- Test: `frontend/src/composables/useProcessLabs.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `cd frontend && npm run test:run -- src/composables/useProcessLabs.test.js`**
- [ ] **Step 3: Implement display-name sanitization and tray chip metadata**
- [ ] **Step 4: Re-run the same test until it passes**

### Task 2: Redesign modal presentation

**Files:**
- Modify: `frontend/src/pages/ProcessPage.vue`
- Test: `frontend/src/pages/ProcessPage.runtime.test.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run `cd frontend && npm run test:run -- src/pages/ProcessPage.runtime.test.js`**
- [ ] **Step 3: Implement the polished modal layout**
- [ ] **Step 4: Re-run the same test until it passes**

### Task 3: Verify frontend

**Files:**
- Verify only

- [ ] **Step 1: Run `cd frontend && npm run lint`**
- [ ] **Step 2: Run `cd frontend && npm run test:run`**
- [ ] **Step 3: Run `cd frontend && npm run build`**
