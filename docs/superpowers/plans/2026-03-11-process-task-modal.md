# Process Task Modal Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the process-page task drawer with a centered modal that shows a task summary and tray summary in place.

**Architecture:** Keep all stateful logic in `useProcessLabs()`, including selected task lookup and tray summary aggregation. Keep `ProcessPage.vue` focused on rendering lab cards plus the read-only modal using the shared modal styles that already exist in the app.

**Tech Stack:** Vue 3, Vitest, existing global app CSS

---

## Chunk 1: Data aggregation

### Task 1: Expand process task detail data

**Files:**
- Modify: `frontend/src/composables/useProcessLabs.js`
- Test: `frontend/src/composables/useProcessLabs.test.js`

- [ ] **Step 1: Write the failing test**

Add assertions that opening task details:
- does not navigate
- opens modal state
- includes tray count
- includes short tray summary text

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- src/composables/useProcessLabs.test.js`

- [ ] **Step 3: Write minimal implementation**

Update `useProcessLabs()` to:
- load `mes.samples`
- derive tray codes for the selected task
- expose `trayCount` and `traySummary`

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- src/composables/useProcessLabs.test.js`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useProcessLabs.js frontend/src/composables/useProcessLabs.test.js
git commit -m "feat: aggregate process task modal summary"
```

## Chunk 2: Modal UI

### Task 2: Replace drawer markup with centered modal summary

**Files:**
- Modify: `frontend/src/pages/ProcessPage.vue`
- Test: `frontend/src/pages/ProcessPage.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add assertions that the process page renders:
- a `.modal` instead of drawer-only content
- task summary fields
- tray summary text

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- src/pages/ProcessPage.runtime.test.js`

- [ ] **Step 3: Write minimal implementation**

Replace the current drawer shell with a centered modal using existing modal classes and a read-only summary layout.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- src/pages/ProcessPage.runtime.test.js`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/ProcessPage.vue frontend/src/pages/ProcessPage.runtime.test.js
git commit -m "feat: redesign process task modal"
```

## Chunk 3: Verification

### Task 3: Full frontend verification

**Files:**
- Verify only

- [ ] **Step 1: Run lint**

Run: `cd frontend && npm run lint`

- [ ] **Step 2: Run all frontend tests**

Run: `cd frontend && npm run test:run`

- [ ] **Step 3: Run frontend build**

Run: `cd frontend && npm run build`

- [ ] **Step 4: Summarize behavior**

Confirm:
- process page stays in place when opening task details
- modal shows summary and tray info
- no regressions in existing frontend tests
