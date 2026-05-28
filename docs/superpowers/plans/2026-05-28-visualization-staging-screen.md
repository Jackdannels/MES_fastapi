# Visualization Staging Screen Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace visualization screen 6 with an industrial staging-room sample information board.

**Architecture:** Add a pure model builder in `frontend/src/modules/visualization/model.js` that derives a staging board view from the local storage snapshot. Render that view in a new `StagingSamplesScreen` component inside `frontend/src/modules/visualization/page.vue`, styled by the existing visualization stylesheet.

**Tech Stack:** Vue 3 render functions, Vitest, Vue Test Utils, existing local storage snapshot composable, CSS modules by page stylesheet.

---

## File Structure

- Modify `frontend/src/modules/visualization/model.js`: add `buildStagingSamplesView` and export it.
- Modify `frontend/src/modules/visualization/model.test.js`: add unit tests for grouping, sample overflow, and capacity calculations.
- Modify `frontend/src/modules/visualization/page.vue`: include `STORAGE_KEYS.staging_events`, replace screen 6 metadata, add `StagingSamplesScreen`, and wire it through `resolveScreenComponent`.
- Modify `frontend/src/modules/visualization/page.runtime.test.js`: add runtime coverage for screen 6 rendering and modal interaction.
- Modify `frontend/src/modules/visualization/styles.css`: add industrial board styles for the staging screen and compact preview.
- Modify `frontend/src/modules/visualization/styles.test.js`: assert required CSS hooks exist.

## Chunk 1: Model

### Task 1: Staging View Builder

**Files:**
- Modify: `frontend/src/modules/visualization/model.js`
- Test: `frontend/src/modules/visualization/model.test.js`

- [ ] **Step 1: Write failing model tests**

Add tests that call `buildStagingSamplesView` with tasks, samples, experiments, experiment trays, and staging events. Verify:

- current staging trays are grouped by task
- selected tray records contain all sample codes
- `visibleSampleCodes` contains only five codes when there are more than five samples
- `overflowSampleCount` is positive for the modal trigger
- capacity defaults to 100 and clamps remaining values at 0
- salt-spray and mold counts are based on resolved experiment/test type text

- [ ] **Step 2: Run model tests and confirm failure**

Run: `rtk npm --prefix frontend test -- model.test.js`

Expected: FAIL because `buildStagingSamplesView` does not exist.

- [ ] **Step 3: Implement model builder**

In `model.js`, add helpers that normalize text, resolve task/tray/sample codes, resolve experiment labels, build latest staging event indexes, and group current staging trays. Export `buildStagingSamplesView(input = {})`.

- [ ] **Step 4: Run model tests and confirm pass**

Run: `rtk npm --prefix frontend test -- model.test.js`

Expected: PASS.

## Chunk 2: Runtime Component

### Task 2: Screen 6 Component

**Files:**
- Modify: `frontend/src/modules/visualization/page.vue`
- Test: `frontend/src/modules/visualization/page.runtime.test.js`

- [ ] **Step 1: Write failing runtime tests**

Add tests that mount visualization with staging sample fixtures and verify:

- screen 6 card name is `暂存间样品信息屏`
- opening screen 6 renders task switch buttons, tray switch buttons, sample codes, and capacity metrics
- clicking a task/tray updates displayed samples
- a tray with more than five samples shows `全部样品`
- clicking `全部样品` opens a modal with all sample codes

- [ ] **Step 2: Run runtime tests and confirm failure**

Run: `rtk npm --prefix frontend test -- page.runtime.test.js`

Expected: FAIL because screen 6 still uses `PlaceholderScreen`.

- [ ] **Step 3: Implement component wiring**

Import `buildStagingSamplesView`, add `STORAGE_KEYS.staging_events` to `useStorageSnapshot`, compute `stagingSamplesView`, update screen 6 metadata, route kind `staging-samples` to `StagingSamplesScreen`, and pass the computed view to dynamic screen components in both card preview and full preview.

- [ ] **Step 4: Implement `StagingSamplesScreen`**

Use render functions consistent with existing screens. Keep local selected task/tray state, derive selected objects from view data, and implement modal state for all-sample display.

- [ ] **Step 5: Run runtime tests and confirm pass**

Run: `rtk npm --prefix frontend test -- page.runtime.test.js`

Expected: PASS.

## Chunk 3: Styles and Verification

### Task 3: Styling

**Files:**
- Modify: `frontend/src/modules/visualization/styles.css`
- Test: `frontend/src/modules/visualization/styles.test.js`

- [ ] **Step 1: Write failing style tests**

Assert that `styles.css` contains staging screen hooks for:

- `.visual-staging-board`
- `.visual-staging-layout`
- `.visual-staging-task-option`
- `.visual-staging-tray-option`
- `.visual-staging-capacity`
- `.visual-staging-modal`
- compact selectors under `.visual-board.is-compact`

- [ ] **Step 2: Run style tests and confirm failure**

Run: `rtk npm --prefix frontend test -- styles.test.js`

Expected: FAIL because selectors do not exist.

- [ ] **Step 3: Add CSS**

Add industrial layout styles using the existing dark board tokens and stable grid dimensions. Ensure touch targets remain large enough and text does not overflow.

- [ ] **Step 4: Run style tests and confirm pass**

Run: `rtk npm --prefix frontend test -- styles.test.js`

Expected: PASS.

### Task 4: Final Verification

**Files:**
- No new files.

- [ ] **Step 1: Run focused tests**

Run:

```powershell
rtk npm --prefix frontend test -- model.test.js page.runtime.test.js styles.test.js
```

Expected: PASS.

- [ ] **Step 2: Run build**

Run:

```powershell
rtk npm --prefix frontend run build
```

Expected: PASS.

- [ ] **Step 3: Report completion**

Summarize changed files, behavior, and verification results. Do not include `.superpowers/brainstorm` as product code.

