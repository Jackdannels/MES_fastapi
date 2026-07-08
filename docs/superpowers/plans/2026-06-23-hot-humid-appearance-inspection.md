# Hot Humid Appearance Inspection Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:test-driven-development. Do not create git commits, branches, or worktrees.

**Goal:** Extend the existing appearance inspection routing rules from salt spray and mold tests to hot-humid tests, covering both 高低温湿热一室 and 高低温湿热二室.

**Architecture:** Keep appearance eligibility in the shared backend service and have API validation delegate to that shared rule. Mirror the same keyword semantics in the frontend flow models so UI-visible flow state matches backend behavior.

**Tech Stack:** FastAPI/Python service tests with pytest; Vue/Vite frontend model tests with Vitest.

---

### Task 1: Backend Shared Rule And Storage API

**Files:**
- Modify: `app/services/appearance_inspection.py`
- Modify: `app/api/routes/storage.py`
- Test: `tests/services/test_laboratory_services.py`
- Test: `tests/api/test_storage.py`

- [ ] Add failing service coverage showing 高低温湿热 targets require pre-experiment appearance routing from handover/staging.
- [ ] Add failing API coverage showing 高低温湿热一室 and 高低温湿热二室 can enter 实验前外观检测间存放.
- [ ] Add failing source coverage showing completed 高低温湿热 can enter 实验后外观检测间存放.
- [ ] Implement by adding 高低温湿热 to the shared appearance eligibility keywords.
- [ ] Remove backend duplicate keyword logic from `storage.py` by delegating to `experiment_requires_appearance_inspection`.
- [ ] Update user-facing rejection copy to include 高低温湿热 or use a generic unsupported-type message.
- [ ] Run targeted pytest commands.

### Task 2: Frontend Flow And Staging Models

**Files:**
- Modify: `frontend/src/modules/samples/sampleFlow.constants.js`
- Modify: `frontend/src/modules/staging-management/model.js`
- Test: `frontend/src/modules/samples/trayFlowConsistency.test.js`
- Test: `frontend/src/modules/staging-management/model.test.js`

- [ ] Add failing frontend coverage that 高低温湿热 is treated as appearance-required in tray flow.
- [ ] Add failing staging-management coverage that 高低温湿热 targets are allowed for pre-experiment appearance handling.
- [ ] Implement by extending the shared frontend keyword helper.
- [ ] Remove or align the staging-management duplicate keyword array so it cannot drift from sample flow constants.
- [ ] Run targeted Vitest commands.

### Task 3: Verification And Cross-Path Audit

**Files:**
- Read-only unless a small missing test is clearly required.

- [ ] Audit REST/API and MQTT/event paths to confirm both reach the shared backend rule or shared storage state.
- [ ] Check for remaining literal `["盐雾", "霉菌"]` or `("盐雾", "霉菌")` eligibility rules.
- [ ] Recommend exact backend and frontend verification commands.
- [ ] After integration, verify no route still rejects 高低温湿热一室/二室 while allowing salt/mold.
