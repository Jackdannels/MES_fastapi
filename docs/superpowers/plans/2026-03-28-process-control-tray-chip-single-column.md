# Process Control Tray Chip Single Column Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep process drawer tray chips one-per-row and automatically reduce their size when tray count grows.

**Architecture:** Leave process drawer data untouched and solve the behavior in the page layer. Add count-aware classes to the tray-chip container so CSS can switch between prominent and dense single-column variants without changing click behavior.

**Tech Stack:** Vue 3, Vitest, Vite

---

## Chunk 1: Runtime Contract

### Task 1: Add a failing runtime test for dense single-column tray chips

**Files:**
- Modify: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Assert that in a multi-tray test-fixture drawer:
- the tray chip container has a single-column/dense class
- the tray chip still has the emphasis class

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/process/page.runtime.test.js`
Expected: FAIL because the chip container does not yet expose the density class.

## Chunk 2: Page Implementation

### Task 2: Implement count-aware single-column tray chip styles

**Files:**
- Modify: `frontend/src/modules/process/page.vue`

- [ ] **Step 1: Add a count-aware class to the tray chip container**

- [ ] **Step 2: Update tray chip list styles to single-column layout**

- [ ] **Step 3: Add dense variant styles for larger tray counts**

- [ ] **Step 4: Re-run the runtime test**

Run: `npm run test:run -- src/modules/process/page.runtime.test.js`
Expected: PASS

## Chunk 3: Verification

### Task 3: Run focused verification

**Files:**
- Modify: `frontend/src/modules/process/page.vue`
- Modify: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: Run process module tests**

Run: `npm run test:run -- src/modules/process`
Expected: PASS

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 3: Run targeted lint**

Run: `npx eslint src/modules/process/page.vue src/modules/process/page.runtime.test.js --ext .js,.vue`
Expected: PASS
