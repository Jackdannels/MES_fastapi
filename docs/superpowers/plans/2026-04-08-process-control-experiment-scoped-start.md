# Process Control Experiment-Scoped Start Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict process-control start actions to the currently selected lab task and experiment, with a confirmation modal that starts only ready trays.

**Architecture:** Keep the existing `useProcessLabs` flow, but introduce per-lab task selection and experiment-scoped tray derivation. Reuse the selected-task detail model for the confirmation modal so the UI and writeback share one source of truth.

**Tech Stack:** Vue 3 composition API, Vitest, existing MES storage snapshot model

---

### Task 1: Lock experiment-scoped tray behavior in tests

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`
- Modify: `frontend/src/modules/process/page.runtime.test.js`

- [ ] Add failing tests for:
  - task switching updates the card context
  - remaining tray count only uses current experiment trays
  - start action only promotes ready trays from the current experiment
  - confirmation modal opens with task/tray/sample details

- [ ] Run:
`npm run test:run -- src/modules/process/useProcessLabs.test.js src/modules/process/page.runtime.test.js`

- [ ] Confirm the new tests fail for the expected reasons

### Task 2: Implement process state and writeback fixes

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.js`

- [ ] Add per-lab selected task state with default fallback to the nearest scheduled task
- [ ] Scope tray rows and counters to the current experiment
- [ ] Add start-confirmation modal state and payload builder
- [ ] Change `startExperiment` to start only ready trays from the current experiment
- [ ] Keep `mes:samples-updated` dispatch after writeback

- [ ] Re-run:
`npm run test:run -- src/modules/process/useProcessLabs.test.js`

### Task 3: Implement process UI updates

**Files:**
- Modify: `frontend/src/modules/process/page.vue`

- [ ] Add task switching controls in the task drawer
- [ ] Add the start-confirmation modal
- [ ] Bind card/button state to the selected task and experiment-scoped counts

- [ ] Re-run:
`npm run test:run -- src/modules/process/page.runtime.test.js`

### Task 4: Regression verification

**Files:**
- Test only

- [ ] Run:
`npm run test:run -- src/modules/process/useProcessLabs.test.js src/modules/process/page.runtime.test.js src/modules/samples/page.runtime.test.js`

- [ ] Confirm all related process and tray-flow regressions stay green
