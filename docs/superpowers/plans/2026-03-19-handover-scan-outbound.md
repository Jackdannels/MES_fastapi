# Handover Scan Outbound Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scan-outbound area to the handover-system sample-process panel so operators can scan one tray code, choose staging or a scheduled lab card, and write the tray/sample outbound status.

**Architecture:** Keep the UI in the shared `SampleProcessPanel`, but gate it behind a handover-only prop. Put outbound destination derivation and tray/sample status mutation in `samplesProcessModel`, and let `useSamplesProcess` load schedules plus hold the outbound form state.

**Tech Stack:** Vue 3, composables, existing samples/tasks/schedules snapshot flow, Vitest

---

## File Structure

- Modify: `frontend/src/modules/samples/SampleProcessPanel.vue`
  - Render the outbound area in the lower-right of the process panel
- Modify: `frontend/src/modules/handover-system/page.vue`
  - Enable outbound mode for the reused panel
- Modify: `frontend/src/modules/samples/useSamplesProcess.js`
  - Load schedules, expose outbound UI state, execute outbound persistence
- Modify: `frontend/src/modules/samples/samplesProcessModel.js`
  - Build outbound cards and apply tray/sample outbound updates
- Modify: `frontend/src/modules/samples/styles.css`
  - Add outbound area and card styles
- Modify: `frontend/src/modules/samples/samplesProcessModel.test.js`
  - Cover destination-card derivation and outbound updates
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`
  - Cover handover-only outbound UI and card states

## Task 1: Lock outbound model behavior with tests

**Files:**
- Modify: `frontend/src/modules/samples/samplesProcessModel.test.js`
- Modify: `frontend/src/modules/samples/samplesProcessModel.js`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run `npm --prefix frontend run test:run -- src/modules/samples/samplesProcessModel.test.js` and verify failure**
- [ ] **Step 3: Implement minimal helpers for outbound card building and tray outbound mutation**
- [ ] **Step 4: Re-run the same test and verify pass**

## Task 2: Lock handover outbound UI with tests

**Files:**
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`
- Modify: `frontend/src/modules/handover-system/page.vue`
- Modify: `frontend/src/modules/samples/SampleProcessPanel.vue`

- [ ] **Step 1: Write the failing runtime test for outbound section visibility and card states**
- [ ] **Step 2: Run `npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js` and verify failure**
- [ ] **Step 3: Add the handover-only outbound UI to the shared panel and enable it from the handover page**
- [ ] **Step 4: Re-run the same test and verify pass**

## Task 3: Wire outbound state through the composable

**Files:**
- Modify: `frontend/src/modules/samples/useSamplesProcess.js`
- Modify: `frontend/src/modules/samples/SampleProcessPanel.vue`
- Modify: `frontend/src/modules/samples/styles.css`

- [ ] **Step 1: Add schedules loading and outbound reactive state**
- [ ] **Step 2: Add handlers for tray-code input, destination selection, and outbound submit**
- [ ] **Step 3: Persist updated samples and emit refresh events after outbound**
- [ ] **Step 4: Run focused regression**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/samples/samplesProcessModel.test.js src/modules/handover-system/page.runtime.test.js src/modules/samples/page.runtime.test.js
```

Expected: PASS

## Task 4: Diff hygiene

**Files:**
- Modify: current working set only

- [ ] **Step 1: Run diff check**

Run:

```bash
git diff --check -- frontend/src/modules/samples/SampleProcessPanel.vue frontend/src/modules/samples/useSamplesProcess.js frontend/src/modules/samples/samplesProcessModel.js frontend/src/modules/samples/styles.css frontend/src/modules/handover-system/page.vue frontend/src/modules/handover-system/page.runtime.test.js frontend/src/modules/samples/samplesProcessModel.test.js
```

Expected: no patch-format errors beyond known line-ending warnings
