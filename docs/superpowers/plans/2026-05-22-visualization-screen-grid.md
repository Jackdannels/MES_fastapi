# Visualization Screen Grid Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the visualization management page as a 2x4 screen-preview grid with single-screen enlargement and an eight-screen combined preview.

**Architecture:** Keep the first version self-contained in the existing visualization module. `page.vue` owns the interaction state, static screen definitions, and rendering structure; `styles.css` owns the screen-card, modal, and combined-preview visual system. Tests verify the new controls and interaction boundaries through Vue runtime behavior.

**Tech Stack:** Vue 3 `<script setup>`, existing Vite/Vitest stack, Vue Test Utils, CSS.

---

## Chunk 1: Visualization Page Structure And Tests

### Task 1: Add Runtime Coverage For Screen Grid Interactions

**Files:**
- Create: `frontend/src/modules/visualization/page.runtime.test.js`
- Modify: `frontend/src/modules/visualization/page.vue`
- Modify: `frontend/src/modules/visualization/styles.css`

- [ ] **Step 1: Write failing tests**

Create tests that mount `VisualizationPage` and verify:
- It renders eight preview cards.
- The first card is the laboratory process monitor screen.
- Clicking the first card opens a single-screen enlargement.
- The lab selector changes the displayed lab name in the enlargement.
- Clicking the top-right full preview button opens the 2x4 combined preview.

- [ ] **Step 2: Run the new test and verify it fails**

Run: `rtk npm run test -- src/modules/visualization/page.runtime.test.js`

Expected: FAIL because the page still only renders the placeholder card.

- [ ] **Step 3: Implement the visualization page**

Replace the placeholder page with:
- A header action row containing `全屏预览`.
- A `visual-screen-grid` with eight 16:9 screen cards.
- A first card for `实验室流程监控屏`, rendered as a non-interactive scaled screen preview with simplified process nodes and lab status.
- Seven placeholder future screen cards.
- A single-screen modal opened by clicking a card.
- An eight-screen combined preview modal opened by the `全屏预览` button.
- A laboratory selector in the single-screen modal for the lab process screen.

- [ ] **Step 4: Add page styles**

Style:
- 2x4 responsive grid.
- Screen preview cards with fixed aspect ratio and no internal controls in thumbnail state.
- Sci-fi dark screen previews inside the existing light management shell.
- Single-screen and combined-preview modal overlays.
- Compact process nodes and status badges.

- [ ] **Step 5: Verify the visualization test passes**

Run: `rtk npm run test -- src/modules/visualization/page.runtime.test.js`

Expected: PASS.

### Task 2: Regression Verification

**Files:**
- Test: `frontend/src/modules/moduleStyles.structure.test.js`
- Test: `frontend/src/modules/visualization/page.runtime.test.js`

- [ ] **Step 1: Run visualization and style tests**

Run: `rtk npm run test -- src/modules/visualization/page.runtime.test.js src/modules/moduleStyles.structure.test.js`

Expected: PASS.

- [ ] **Step 2: Run the full frontend suite**

Run: `rtk npm run test -- --run`

Expected: PASS.
