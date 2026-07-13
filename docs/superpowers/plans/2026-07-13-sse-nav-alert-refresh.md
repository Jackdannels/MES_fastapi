# SSE Navigation Alert Refresh Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the app-wide five-second storage polling used by navigation alerts with storage-update events and a visible-page fallback refresh.

**Architecture:** Keep `App.vue` responsible only for deriving navigation alerts from a storage snapshot. Subscribe to the existing storage SSE bridge through `useStorageSnapshotRefresh`, refreshing only for the alert-relevant storage keys. A 60-second timer refreshes only while the document is visible, so missed events and reconnections self-heal without continuous full-snapshot reads.

**Tech Stack:** Vue 3 Composition API, Vitest, existing `useStorageSnapshotRefresh` composable.

---

## Chunk 1: Navigation alert refresh behavior

### Task 1: Test event-driven alert refresh

**Files:**
- Modify: `frontend/src/App.runtime.test.js`
- Modify: `frontend/src/App.vue`

- [x] Add a failing runtime test that captures the refresh callback supplied to `useStorageSnapshotRefresh`, mounts the app, invokes the callback, and asserts another snapshot read occurs.
- [x] Run `npm run test:run -- src/App.runtime.test.js` from `frontend`; verify it fails because `App.vue` does not subscribe.
- [x] Add `useStorageSnapshotRefresh` to `App.vue`, watching only the five keys used by alert derivation and using `refreshTaskOverviewAlert` as the callback.
- [x] Re-run the focused test; verify it passes.

### Task 2: Test visible-page fallback and poll removal

**Files:**
- Modify: `frontend/src/App.runtime.test.js`
- Modify: `frontend/src/App.vue`

- [x] Add a failing fake-timer test proving no refresh occurs at 5 seconds, a refresh occurs at 60 seconds while visible, and it does not occur while the document is hidden.
- [x] Run the focused test; verify it fails against the existing fixed five-second interval.
- [x] Replace the five-second timer with a 60-second fallback timer guarded by `document.visibilityState`; clear it during unmount.
- [x] Re-run the focused test; verify it passes.

### Task 3: Verification

**Files:**
- Verify: `frontend/src/App.runtime.test.js`
- Verify: `frontend/src`

- [x] Run `npm run test:run -- src/App.runtime.test.js` from `frontend`.
- [ ] Run `npm run lint` from `frontend` (blocked by 16 pre-existing errors outside this change; targeted lint passed).
- [x] Run `npm run build` from `frontend`.
