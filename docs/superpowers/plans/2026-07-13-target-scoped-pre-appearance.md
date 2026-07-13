# Target-Scoped Pre-Experiment Appearance Inspection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a tray to complete one pre-experiment appearance inspection for each required target experiment while still rejecting a duplicate for the same target.

**Architecture:** Persist phase and target experiment context on new appearance events. Scope repeat detection to a matching pre-inspection dispatch event. All data will be reset, so legacy events are intentionally ignored. The storage validation path remains shared by MQTT and local hostless simulation.

**Tech Stack:** Python, FastAPI, pytest, existing storage tray actions and appearance-inspection helpers.

---

## Chunk 1: Target-scoped appearance guard

### Task 1: Add failing regressions

**Files:**
- Modify: `tests/api/test_storage.py`
- Modify: `tests/services/test_laboratory_services.py`

- [x] Add a failing API regression that reproduces salt pre/post appearance, staging, and a subsequent high-low-temperature/humidity pre-inspection; assert it is allowed.
- [x] Add service assertions that a salt pre-dispatch blocks salt again but does not block a hot-humid target.
- [x] Run the focused pytest selection and observe the new cross-target regression fail.

### Task 2: Scope guard and emit context

**Files:**
- Modify: `app/services/appearance_inspection.py`
- Modify: `app/api/routes/storage.py`
- Modify: `app/services/storage_tray_actions.py`

- [x] Add `appearance_phase` and `experiment_code` to new appearance events.
- [x] Make repeat detection accept the requested target experiment and inspect only same-target pre-dispatches; preserve same-target withdrawal handling and ignore unscoped legacy events.
- [x] Pass the target experiment code through the current tray, which is already supplied to both storage validation call sites.
- [x] Run focused pytest selection and verify it passes.

### Task 3: Broader regression verification

**Files:**
- Verify: `tests/api/test_storage.py`
- Verify: `tests/services/test_laboratory_services.py`
- Verify: `tests/api/test_mq.py`

- [x] Run the complete focused storage and laboratory-service test files.
- [x] Run relevant MQTT tests to confirm shared workflow behavior.
- [ ] Run `pytest -q` for backend regression verification (589 passed; 3 existing unrelated failures in router-registry and task-reset expectations).
