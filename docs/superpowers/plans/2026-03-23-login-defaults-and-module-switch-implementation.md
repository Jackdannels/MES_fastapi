# Login Defaults And Module Switch Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Default the login form to the demo credentials and replace direct logout actions with a shared exit dialog that supports either full logout or in-session module switching.

**Architecture:** Keep module routing and auth semantics unchanged, but centralize module labels in shared auth metadata, add a reusable exit dialog component, and wire both `App.vue` and the handover standalone page to use the same flow. Login defaults are applied in the login form composable so the template remains clean.

**Tech Stack:** Vue 3, Vue Router 4, Vitest, Vue Test Utils

---

## Chunk 1: Tests First

### Task 1: Lock the new login defaults and exit-dialog behavior in tests

**Files:**
- Modify: `frontend/src/modules/login/useLoginForm.test.js`
- Create: `frontend/src/components/shared/ModuleExitDialog.test.js`
- Modify: `frontend/src/App.runtime.test.js`
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- login form starts with `admin / 123`
- exit dialog renders cancel/logout/switch controls and current-module default selection
- App shell opens the dialog instead of logging out immediately
- App shell switches modules without calling logout
- handover page uses the same dialog semantics

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm run test:run -- src/modules/login/useLoginForm.test.js src/components/shared/ModuleExitDialog.test.js src/App.runtime.test.js src/modules/handover-system/page.runtime.test.js
```

Expected:

- current implementation logs out immediately
- login form still starts blank
- shared exit dialog component does not exist yet

## Chunk 2: Shared Module Metadata And Dialog Component

### Task 2: Add shared module labels and the exit dialog component

**Files:**
- Modify: `frontend/src/auth.js`
- Create: `frontend/src/components/shared/ModuleExitDialog.vue`

- [ ] **Step 1: Write minimal implementation**

Add shared module label metadata and create the dialog component with:

- visible module select
- current-module default selection
- inline validation message
- `close`, `logout`, `switch-module` emits

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm run test:run -- src/components/shared/ModuleExitDialog.test.js
```

Expected:

- dialog behavior tests pass

## Chunk 3: Login Defaults And App Wiring

### Task 3: Apply default credentials and wire the shared app shell

**Files:**
- Modify: `frontend/src/modules/login/useLoginForm.js`
- Modify: `frontend/src/modules/login/page.vue`
- Modify: `frontend/src/App.vue`

- [ ] **Step 1: Write minimal implementation**

Update:

- login composable default refs to `admin` and `123`
- `App.vue` to open the exit dialog, switch modules via `resolveModuleHome`, and only call `logoutSession` on full logout

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm run test:run -- src/modules/login/useLoginForm.test.js src/App.runtime.test.js
```

Expected:

- login defaults pass
- App shell exit flow tests pass

## Chunk 4: Handover Wiring And Final Verification

### Task 4: Wire the standalone handover page and verify the full feature slice

**Files:**
- Modify: `frontend/src/modules/handover-system/page.vue`
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write minimal implementation**

Connect the shared exit dialog into the handover page so it matches the same behavior as `App.vue`.

- [ ] **Step 2: Run focused verification**

Run:

```bash
npm run test:run -- src/modules/login/useLoginForm.test.js src/components/shared/ModuleExitDialog.test.js src/App.runtime.test.js src/modules/handover-system/page.runtime.test.js
```

Expected:

- all targeted tests pass

- [ ] **Step 3: Build the frontend**

Run:

```bash
npm run build
```

Expected:

- Vite build succeeds
