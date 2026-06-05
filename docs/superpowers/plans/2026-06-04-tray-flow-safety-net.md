# Tray Flow Safety Net Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add regression coverage that prevents tray flow logic from being changed incorrectly before unifying the flow output.

**Architecture:** Use the existing flow builders as the system under test. Add high-risk snapshot scenarios first, then make the smallest code changes only if those tests reveal a mismatch.

**Tech Stack:** Vue/Vitest frontend model tests, existing MES snapshot model helpers, FastAPI/Pytest for MQTT guards if needed.

---

## Chunk 1: Frontend Tray Flow Safety Net

### Task 1: Central Overview Must Use Tray-Directed Lab

**Files:**
- Modify: `frontend/src/modules/task-overview/model.test.js`
- Maybe modify: `frontend/src/modules/task-overview/model.js`

- [x] **Step 1: Write failing test**

Add a test where one task has multiple experiments and schedules, but each tray carries its own `target_lab` and `target_experiment_code`. Assert central tray overview shows each tray going to its own directed lab and never the latest unrelated task-level schedule.

- [x] **Step 2: Run test to verify behavior**

Run: `rtk npm --prefix frontend run test:run -- src/modules/task-overview/model.test.js -t "directed lab"`

- [x] **Step 3: Minimal implementation if failing**

Only adjust the overview flow context selection. Do not rewrite `buildTrayFlowView`.

- [x] **Step 4: Run test again**

Run the same targeted command, then the whole file.

### Task 2: Cross-Page Flow Consistency

**Files:**
- Create or modify: `frontend/src/modules/samples/trayFlowConsistency.test.js`
- Maybe modify: `frontend/src/modules/samples/samplesFlowModel.js`
- Maybe modify: `frontend/src/modules/laboratory/model.js`
- Maybe modify: `frontend/src/modules/visualization/model.js`
- Maybe modify: `frontend/src/modules/task-overview/model.js`

- [x] **Step 1: Write consistency test**

Use one shared snapshot with trays directed to different labs. Assert central overview, laboratory view, visualization view, and direct `buildTrayFlowView` agree on tray target lab and active/running status.

- [x] **Step 2: Run test to verify behavior**

Run: `rtk npm --prefix frontend run test:run -- src/modules/samples/trayFlowConsistency.test.js`

- [x] **Step 3: Minimal implementation if failing**

Route all page-specific callers through the same tray-level flow context or align their inputs. Keep page visibility rules separate from true tray flow.

- [x] **Step 4: Run related flow tests**

Run `samplesFlowModel`, `laboratory/model`, `visualization/model`, `task-overview/model`, and `process/useProcessLabs` tests.

### Task 3: A Completed, B Full Flow

**Files:**
- Modify: `frontend/src/modules/samples/samplesFlowModel.test.js`
- Maybe modify: `frontend/src/modules/samples/samplesFlowModel.js`

- [x] **Step 1: Write test**

Assert that after A experiment is complete, A appears only as completed summary and B expands its own complete route without reusing A route times.

- [x] **Step 2: Run targeted test**

Run: `rtk npm --prefix frontend run test:run -- src/modules/samples/samplesFlowModel.test.js -t "completed experiment"`

- [x] **Step 3: Minimal implementation if failing**

Fix only experiment-scoped time/status selection.

### Task 4: MQTT/Mock Start Guard Regression

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`
- Modify: `tests/api/test_mq.py`
- Maybe modify: `app/services/mq_event_processor.py`

- [x] **Step 1: Write/extend tests**

Assert a tray completed in impact and moved to temperature shock cannot be started from impact in mock or MQTT.

- [x] **Step 2: Run targeted frontend/backend tests**

Run:
- `rtk npm --prefix frontend run test:run -- src/modules/process/useProcessLabs.test.js -t "restart"`
- `rtk .venv\Scripts\python.exe -m pytest -q tests/api/test_mq.py -k "restart or completed"`

- [x] **Step 3: Minimal implementation if failing**

Make the start guard rely on current tray experiment context rather than stale schedules or completed experiments.

## Chunk 2: Verification

- [x] Run frontend flow group.
- [x] Run backend MQTT/laboratory group.
- [x] Run full frontend tests.
- [x] Run full backend tests.

## Notes

- `buildTrayFlowView` now exposes both UI-facing `status/currentStatus` and business-facing `canonicalStatus`.
- Central overview and visualization rows forward `canonicalStatus` so future logic does not parse concrete lab display labels.
- MQTT regressions cover stale old-lab start/end events after a tray moves to the next laboratory.
