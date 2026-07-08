# Process Control Tray Sample List Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the process drawer's right-side supplement card with a selected-tray sample-number list and keep the left summary tray-focused.

**Architecture:** Reuse the existing selected-tray state in the process drawer. Update the page template so the left summary shows only tray-level information, while the right-side card renders the selected tray's `sampleCodes` as a one-item-per-line list.

**Tech Stack:** Vue 3, Vitest, Vite

---

## Chunk 1: Runtime Contract

### Task 1: Lock the new drawer layout in a runtime test

**Files:**
- Modify: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add assertions that:
- the card title is `样品编号`
- `补充信息` is absent
- the selected tray summary no longer repeats tray sample numbers
- the right-side sample list renders one line per sample

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- src/modules/process/page.runtime.test.js`
Expected: FAIL because the current page still renders `补充信息` and left-side sample details.

### Task 2: Update selected tray test data for list rendering

**Files:**
- Modify: `frontend/src/modules/process/page.runtime.test.js`

- [ ] **Step 1: Add explicit `sampleCodes` arrays to the test tray rows**

- [ ] **Step 2: Re-run the test**

Run: `npm run test:run -- src/modules/process/page.runtime.test.js`
Expected: FAIL with UI mismatch, not test data errors.

## Chunk 2: Drawer UI

### Task 3: Replace the supplement card with sample list rendering

**Files:**
- Modify: `frontend/src/modules/process/page.vue`

- [ ] **Step 1: Implement the minimal template change**

Update the right summary card to:
- use title `样品编号`
- render `selectedTaskDetail.selectedTraySummary.sampleCodes`
- show one sample per row

Update the left selected tray card to remove the sample-number block.

- [ ] **Step 2: Adjust styles only as needed**

Keep the layout structure unchanged; add only the list styles needed for the new sample-number card.

- [ ] **Step 3: Run the runtime test**

Run: `npm run test:run -- src/modules/process/page.runtime.test.js`
Expected: PASS

## Chunk 3: Verification

### Task 4: Run focused verification

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
