# Target-Scoped Frontend Pre-Appearance Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep appearance-inspection completion state scoped to the target experiment in the staging-management frontend.

**Architecture:** Replace the broad prior-appearance-stock-in check with an explicit pre-inspection appearance stock-out match. The match uses phase and target experiment code from existing staging events and only affects frontend row eligibility.

**Tech Stack:** JavaScript, Vitest, Vue frontend model.

---

## Chunk 1: Target-scoped event predicate

### Task 1: Correct frontend pending-inbound state

**Files:**
- Modify: `frontend/src/modules/staging-management/model.js:576-600`
- Modify: `frontend/src/modules/staging-management/model.test.js`

- [ ] **Step 1: Write a failing regression test**

Build a tray history containing A pre stock-in/out, A post stock-in/out, staging stock-in, and a latest B lab dispatch. Assert the appearance row is `待入库` and `stockIn` has no error.

- [ ] **Step 2: Run the focused Vitest test**

Run: `npm test -- model.test.js --run`

Expected: FAIL because the current broad predicate treats A appearance stock-in as B pre-inspection.

- [ ] **Step 3: Implement the minimal event match**

Compare the current dispatch target experiment code against an earlier `room: appearance`, `action: stock_out`, `appearance_phase: pre_experiment` event. Do not use stock-in events or unscoped events.

- [ ] **Step 4: Run focused and related tests**

Run: `npm test -- model.test.js --run`

Expected: PASS.

Note: Do not create a git commit; project rules require explicit user authorization.
