# Schedule Task-Scoped Gantt Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the schedule gantt focus on the selected task's labs, keep one stable color per task, and render up to two non-overlapping tasks inside the same half-day cell without resizing the grid.

**Architecture:** Extend the schedule view model so the gantt builder receives the selected task code and emits richer per-cell data. Keep the existing create/edit/delete schedule flows intact while updating the page template and stylesheet to render stacked task items inside the existing fixed-size cells.

**Tech Stack:** Vue 3, Vue Test Utils, Vitest

---

## Chunk 1: Model Coverage

### Task 1: Add failing gantt model tests for task-scoped lab filtering and stacked cells

**Files:**
- Modify: `frontend/src/modules/schedule/model.test.js`

- [ ] **Step 1: Write the failing test for selected-task lab scoping**
- [ ] **Step 2: Run `npm run test:run -- src/modules/schedule/model.test.js -t "buildGanttRows scopes rows to the selected task labs"` and verify it fails**
- [ ] **Step 3: Write the failing test for stable task color across labs**
- [ ] **Step 4: Run `npm run test:run -- src/modules/schedule/model.test.js -t "buildGanttRows keeps one stable color per task across labs"` and verify it fails**
- [ ] **Step 5: Write the failing test for two non-overlapping tasks stacking in one half-day cell**
- [ ] **Step 6: Run `npm run test:run -- src/modules/schedule/model.test.js -t "buildGanttRows stacks two non-overlapping tasks in one half-day cell"` and verify it fails**
- [ ] **Step 7: Write the failing test for `+N` overflow when three or more tasks share one half-day cell**
- [ ] **Step 8: Run `npm run test:run -- src/modules/schedule/model.test.js -t "buildGanttRows truncates stacked cells after two tasks and reports overflow"` and verify it fails**

### Task 2: Implement the minimal gantt model changes

**Files:**
- Modify: `frontend/src/modules/schedule/model.js`
- Test: `frontend/src/modules/schedule/model.test.js`

- [ ] **Step 1: Add helpers to derive the selected task's visible labs from experiments and schedules**
- [ ] **Step 2: Add a stable task-color resolver keyed by `task_code`**
- [ ] **Step 3: Change half-day cell aggregation to distinguish conflict vs legal multi-task stacking**
- [ ] **Step 4: Emit per-cell item lists, overflow counts, and task colors without changing create/edit/delete schedule behavior**
- [ ] **Step 5: Re-run `npm run test:run -- src/modules/schedule/model.test.js` and verify the model suite passes**

## Chunk 2: Composable and Page Coverage

### Task 3: Add failing composable and runtime tests for the new gantt context

**Files:**
- Modify: `frontend/src/modules/schedule/useSchedulePage.test.js`
- Modify: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: Write the failing composable test asserting gantt input follows selected task code instead of selected device**
- [ ] **Step 2: Run `npm run test:run -- src/modules/schedule/useSchedulePage.test.js -t "uses the selected task code to scope the gantt view"` and verify it fails**
- [ ] **Step 3: Write the failing runtime test asserting the gantt only shows labs tied to the selected task**
- [ ] **Step 4: Run `npm run test:run -- src/modules/schedule/page.runtime.test.js -t "filters gantt rows to the selected task labs"` and verify it fails**
- [ ] **Step 5: Write the failing runtime test asserting stacked cell rendering and `+N` overflow text**
- [ ] **Step 6: Run `npm run test:run -- src/modules/schedule/page.runtime.test.js -t "renders stacked task codes inside one half-day gantt cell"` and verify it fails**

### Task 4: Implement the minimal composable and template changes

**Files:**
- Modify: `frontend/src/modules/schedule/useSchedulePage.js`
- Modify: `frontend/src/modules/schedule/page.vue`
- Test: `frontend/src/modules/schedule/useSchedulePage.test.js`
- Test: `frontend/src/modules/schedule/page.runtime.test.js`

- [ ] **Step 1: Pass the selected task code into `buildGanttRows` and remove the current selected-device gantt scoping dependency**
- [ ] **Step 2: Render gantt cells from item lists, including stacked labels and `+N`**
- [ ] **Step 3: Preserve click-through to task detail for single-schedule cells and keep conflict cells non-regressing**
- [ ] **Step 4: Re-run the focused composable and runtime tests and verify they pass**

## Chunk 3: Styles and Verification

### Task 5: Add the fixed-size stacked gantt styles

**Files:**
- Modify: `frontend/src/modules/schedule/styles.css`
- Modify: `frontend/src/assets/ganttStyles.structure.test.js`

- [ ] **Step 1: Add a failing structure assertion for the stacked gantt cell classes**
- [ ] **Step 2: Run `npm run test:run -- src/assets/ganttStyles.structure.test.js -t "gantt stacked task styles stay in the schedule module stylesheet"` and verify it fails**
- [ ] **Step 3: Add stacked layout styles, task item rows, and overflow badge styles without changing cell dimensions**
- [ ] **Step 4: Re-run `npm run test:run -- src/assets/ganttStyles.structure.test.js` and verify it passes**

### Task 6: Run focused regression verification

**Files:**
- Verify: `frontend/src/modules/schedule/model.test.js`
- Verify: `frontend/src/modules/schedule/useSchedulePage.test.js`
- Verify: `frontend/src/modules/schedule/page.runtime.test.js`
- Verify: `frontend/src/assets/ganttStyles.structure.test.js`

- [ ] **Step 1: Run `npm run test:run -- src/modules/schedule/model.test.js src/modules/schedule/useSchedulePage.test.js src/modules/schedule/page.runtime.test.js src/assets/ganttStyles.structure.test.js`**
- [ ] **Step 2: Record any residual gaps if a broader frontend run is skipped**
- [ ] **Step 3: Summarize the verification outcome with the exact command used**
