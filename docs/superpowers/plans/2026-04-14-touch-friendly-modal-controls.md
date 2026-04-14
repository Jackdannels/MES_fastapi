# 触控友好的弹窗按钮与实验室重置按钮 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the laboratory reset button and shared modal footer actions easier to tap on touch screens without changing the existing layout structure or business behavior.

**Architecture:** Keep the change CSS-only where possible. Use shared style updates in the global button and modal styles to improve tap targets across existing `AppModal` footers, then add one laboratory-specific size adjustment for the reset button so the salt-spray header remains visually balanced.

**Tech Stack:** Vue 3, shared CSS modules, Vitest runtime tests

---

## Chunk 1: Lock Touch-Friendly Modal Footer Behavior

### Task 1: Add or adjust runtime coverage for modal footer interaction regressions

**Files:**
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`
- Modify: `frontend/src/modules/staging-management/page.runtime.test.js`
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

- [ ] **Step 1: Write the failing or locking tests**

Add or tighten assertions around the existing modal flows so the global footer restyle cannot silently break behavior:
- laboratory reset confirm chain still opens both dialogs
- staging scan modal still opens and confirms normally
- transfer dispatch flow still opens and completes existing actions

Prefer assertions on visible controls and flow continuity rather than brittle class snapshots.

- [ ] **Step 2: Run the focused runtime suites before CSS changes**

Run:
`npm run test:run -- src/modules/laboratory/page.runtime.test.js`
`npm run test:run -- src/modules/staging-management/page.runtime.test.js`
`npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

Expected: PASS, giving a clean baseline before the touch-style edits.

## Chunk 2: Update Shared Button And Modal Touch Targets

### Task 2: Make shared modal controls more touch friendly

**Files:**
- Modify: `frontend/src/shared/styles/components.css`
- Modify: `frontend/src/shared/styles/shell.css`

- [ ] **Step 1: Write the minimal shared style changes**

Update `frontend/src/shared/styles/components.css`:
- increase `.form-actions` spacing
- change footer alignment to a left/right distribution that still works for two-button confirm dialogs
- keep wrap support or add a narrow-screen fallback so crowded dialogs do not overflow
- enlarge `.modal-close` to a more touch-friendly target

Update `frontend/src/shared/styles/shell.css`:
- slightly increase `.action-btn` height, padding, radius, and font size
- keep `secondary` and `danger` color semantics unchanged

- [ ] **Step 2: Run the focused runtime suites after shared style changes**

Run:
`npm run test:run -- src/modules/laboratory/page.runtime.test.js`
`npm run test:run -- src/modules/staging-management/page.runtime.test.js`
`npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

Expected: PASS

## Chunk 3: Enlarge The Laboratory Reset Button Without Reflow

### Task 3: Apply the module-specific reset-button sizing

**Files:**
- Modify: `frontend/src/modules/laboratory/styles.css`

- [ ] **Step 1: Write the minimal laboratory style change**

Adjust `.laboratory-reset-button` so it:
- stays in the current header position
- remains single-line
- gains a modestly larger height and horizontal padding
- keeps the red danger styling and capsule feel

Do not change `laboratory-control-header` structure unless required to prevent clipping on smaller widths.

- [ ] **Step 2: Run laboratory runtime verification again**

Run:
`npm run test:run -- src/modules/laboratory/page.runtime.test.js`

Expected: PASS

## Chunk 4: Review Final Scope

### Task 4: Verify impact area and regression safety

**Files:**
- Verify only

- [ ] **Step 1: Review the final diff scope**

Run:
`git diff --stat -- frontend/src/shared/styles/components.css frontend/src/shared/styles/shell.css frontend/src/modules/laboratory/styles.css frontend/src/modules/laboratory/page.runtime.test.js frontend/src/modules/staging-management/page.runtime.test.js frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`

Expected: only shared modal/button styles, the laboratory reset-button styles, and any touched runtime tests appear.

- [ ] **Step 2: Summarize manual visual check points**

Record these for the final report:
- reset button remains on one line in the salt-spray header
- modal buttons are easier to tap and sit farther apart
- narrow screens still stack or wrap cleanly without overflow
