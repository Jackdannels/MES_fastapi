# Visualization Shared Lab Process Screens Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make visualization screens 1 and 5 jointly show four active laboratory process panels with non-duplicating lab switching, while moving the original screen 5 today-plan board to screen 3.

**Architecture:** Reuse the existing `LabProcessScreen` component and `buildLabProcessPanels` data model. Add separate selected lab slots for screen 1 and screen 5, derive two pairs from the shared active lab ordering, route screen 5 to the lab-process renderer with a distinct group, and route screen 3 to the existing today task plan renderer.

**Tech Stack:** Vue 3 render functions, Vitest, Vue Test Utils.

---

## Chunk 1: Shared 1/5 Lab Process Screens

### Task 1: Add failing runtime coverage

**Files:**
- Modify: `frontend/src/modules/visualization/page.runtime.test.js`

- [ ] **Step 1: Write the failing tests**

Add tests that mount the visualization page with five lab fixtures and verify:
- card 1 and card 5 both render lab process panels
- card 3 renders the original today task plan board
- the first four displayed lab names are the four active labs without duplicates
- card 5 no longer contains the today task plan content
- the enlarged fifth screen opens with two lab panels

- [ ] **Step 2: Run tests to verify RED**

Run: `rtk npm run test -- src/modules/visualization/page.runtime.test.js`

Expected: FAIL because screen 5 still renders the today task plan board and only screen 1 owns lab-process panels.

### Task 2: Implement shared lab slot selection

**Files:**
- Modify: `frontend/src/modules/visualization/page.vue`

- [ ] **Step 1: Add slot state**

Replace the two selected lab refs with four selected lab refs keyed by screen group and position.

- [ ] **Step 2: Derive default and selected lab pairs**

Derive:
- `defaultPrimaryLabs` from active order indexes 0 and 1
- `defaultSecondaryLabs` from active order indexes 2 and 3
- `selectedPrimaryLabs`
- `selectedSecondaryLabs`

Selection fallback must avoid duplicates across all four positions.

- [ ] **Step 3: Route screen 5 to lab process**

Change screen card 3 metadata to `today-task-plan` and screen card 5 metadata from `today-task-plan` to a second lab-process kind or group. Pass the correct lab pair to `LabProcessScreen` in thumbnail, single preview, and combined preview, and pass an empty lab list to non-lab screens.

- [ ] **Step 4: Update picker logic**

Track picker group and position, exclude labs already selected in other visible slots, and update the selected slot when a picker option is chosen.

### Task 3: Verify and adjust styles if needed

**Files:**
- Modify: `frontend/src/modules/visualization/styles.css` only if visual fit requires it
- Test: `frontend/src/modules/visualization/styles.test.js` only if CSS hooks change

- [ ] **Step 1: Run runtime tests**

Run: `rtk npm run test -- src/modules/visualization/page.runtime.test.js`

Expected: PASS.

- [ ] **Step 2: Run focused visualization tests**

Run: `rtk npm run test -- src/modules/visualization/page.runtime.test.js src/modules/visualization/styles.test.js`

Expected: PASS.

- [ ] **Step 3: Browser check**

Start the frontend if needed, open `/visualization`, and confirm visually that screen 1 and screen 5 both use the lab process design and together show four lab panels.
