# Handover Standalone Shell Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the handover module render as a standalone page without the shared app shell and add an in-page logout action styled consistently with the existing system shell.

**Architecture:** Keep the shared shell for all other modules, but special-case `handover` in `App.vue` so it renders only the route page. Move the logout affordance into the handover page itself and style its new top section using the same typography, spacing, button language, and surface treatment already used by the shared shell.

**Tech Stack:** Vue 3, Vue Router, shared shell CSS, Vitest

---

## File Structure

- Modify: `frontend/src/App.vue`
  - Bypass the shared shell for the handover module only
- Modify: `frontend/src/App.runtime.test.js`
  - Assert handover routes do not render the shared shell
- Modify: `frontend/src/modules/handover-system/page.vue`
  - Add in-page system header and logout action
- Modify: `frontend/src/modules/handover-system/styles.css`
  - Style the in-page header to match the app shell language
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`
  - Verify the logout button and logout flow

## Chunk 1: Shell Boundary

### Task 1: Add a failing test for handover standalone rendering

**Files:**
- Modify: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Write the failing test**

Add coverage that proves a `handover` route does not render the shared shell branding or shared header actions.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/App.runtime.test.js
```

Expected: FAIL because `handover` still uses the shared shell today.

- [ ] **Step 3: Write minimal implementation**

Update `App.vue` so only the handover module bypasses the shell and renders the route page directly.

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 2: In-Page Logout

### Task 2: Add a failing test for the handover page logout button

**Files:**
- Modify: `frontend/src/modules/handover-system/page.runtime.test.js`
- Modify: `frontend/src/modules/handover-system/page.vue`
- Modify: `frontend/src/modules/handover-system/styles.css`

- [ ] **Step 1: Write the failing test**

Add coverage that proves:

- the handover page shows an internal system header
- the page shows a logout button
- clicking it calls logout and routes to `/login`

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/handover-system/page.runtime.test.js
```

Expected: FAIL because the page does not yet expose its own logout affordance.

- [ ] **Step 3: Write minimal implementation**

Implement the in-page header and logout button, using the existing auth helpers and shell visual language.

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 3: Focused Verification

### Task 3: Verify shell boundary and standalone page behavior together

**Files:**
- Test: `frontend/src/App.runtime.test.js`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Run focused regression**

Run:

```bash
npm --prefix frontend run test:run -- src/App.runtime.test.js src/modules/handover-system/page.runtime.test.js
```

Expected: PASS

- [ ] **Step 2: Run build verification**

Run:

```bash
npm --prefix frontend run build
```

Expected: PASS

- [ ] **Step 3: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no patch-format errors.
