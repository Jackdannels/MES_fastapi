# Process Control Tray Chip Emphasis Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the process drawer tray summary text block and make the tray code chips the primary, more prominent selector.

**Architecture:** Keep the current selected-tray state and chip click behavior unchanged. Simplify the left execution summary by removing the tray-summary field and restyling the tray chips to be larger and more visually dominant.

**Tech Stack:** Vue 3, Vitest, Vite

---

## Chunk 1: Runtime Contract

### Task 1: Lock the simplified summary layout in tests

**Files:**
- Modify: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Assert that:
- `托盘摘要` no longer renders
- tray chips still render
- tray chips expose a stronger presentation hook/class for larger styling

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/process/page.runtime.test.js`
Expected: FAIL because the old tray-summary block still exists and tray chips are not upgraded.

## Chunk 2: Drawer UI

### Task 2: Remove tray summary and enlarge tray chips

**Files:**
- Modify: `frontend/src/modules/process/page.vue`

- [ ] **Step 1: Remove the tray summary field from the left summary card**

- [ ] **Step 2: Increase tray chip size and emphasis with minimal style changes**

- [ ] **Step 3: Run the runtime test**

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
