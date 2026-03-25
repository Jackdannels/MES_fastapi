# Handover System Samples Process Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `接驳区系统` module entry and first landing page that reuses the existing `样品流程管理` panel from the central system.

**Architecture:** Keep the new module thin. Extract the existing samples-process area into a focused reusable panel component, then mount that panel inside both the central samples page and the new handover-system page. Authentication and module routing continue using the existing login/module registry flow so both systems share the same underlying task/sample state.

**Tech Stack:** Vue 3, module registry routing, existing auth module mapping, composables, Vitest

---

## File Structure

- Modify: `frontend/src/modules/login/page.vue`
  - Add the new system option in the login selector
- Modify: `frontend/src/auth.js`
  - Add the new module key and home-route mapping
- Modify: `frontend/src/modules/index.js`
  - Register the new module
- Create: `frontend/src/modules/handover-system/index.js`
  - Define the route/module metadata
- Create: `frontend/src/modules/handover-system/page.vue`
  - Render the handover-system page shell and reused sample-process panel
- Create: `frontend/src/modules/handover-system/styles.css`
  - Add any module-local layout polish if needed
- Create: `frontend/src/modules/samples/SampleProcessPanel.vue`
  - Extract the current “样品流程管理” block into a reusable component
- Modify: `frontend/src/modules/samples/SamplesManagementPanel.vue`
  - Replace the inlined process area with the new reusable panel
- Modify: `frontend/src/modules/login/useLoginForm.test.js`
  - Cover new module selection if needed
- Modify: `frontend/src/auth.test.js`
  - Cover module-home resolution for handover system
- Modify: `frontend/src/modules/modules.structure.test.js`
  - Cover module registry inclusion
- Create: `frontend/src/modules/handover-system/page.runtime.test.js`
  - Verify the new page renders the reused process panel
- Modify: `frontend/src/modules/samples/page.structure.test.js`
  - Ensure samples page still uses component extraction cleanly if needed

## Chunk 1: Login And Routing

### Task 1: Add the handover-system login entry

**Files:**
- Modify: `frontend/src/modules/login/page.vue`
- Modify: `frontend/src/auth.js`
- Test: `frontend/src/auth.test.js`
- Test: `frontend/src/modules/login/useLoginForm.test.js`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- login UI exposing `接驳区系统`
- auth module-home resolution returning the new route for the new module key

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/auth.test.js src/modules/login/useLoginForm.test.js
```

Expected: FAIL because the new module option and mapping do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- login selector option for `接驳区系统`
- auth routing mapping from the new module key to the new module route

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 2: Reusable Sample Process Panel

### Task 2: Extract the samples process area

**Files:**
- Create: `frontend/src/modules/samples/SampleProcessPanel.vue`
- Modify: `frontend/src/modules/samples/SamplesManagementPanel.vue`
- Test: `frontend/src/modules/samples/page.structure.test.js`
- Test: `frontend/src/modules/samples/page.runtime.test.js`

- [ ] **Step 1: Write the failing tests**

Add or adjust coverage so it proves:

- the central samples page still renders the existing `样品流程管理`
- extraction does not leave duplicate inline markup in `SamplesManagementPanel.vue` if structure tests care

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/samples/page.structure.test.js src/modules/samples/page.runtime.test.js
```

Expected: FAIL once the tests assert the extracted structure.

- [ ] **Step 3: Write minimal implementation**

Implement:

- new reusable `SampleProcessPanel.vue`
- central samples page consuming the new panel with the existing `samplesProcess` prop surface

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 3: New Handover System Module

### Task 3: Register the new module and page

**Files:**
- Create: `frontend/src/modules/handover-system/index.js`
- Create: `frontend/src/modules/handover-system/page.vue`
- Create: `frontend/src/modules/handover-system/styles.css`
- Modify: `frontend/src/modules/index.js`
- Test: `frontend/src/modules/modules.structure.test.js`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`

- [ ] **Step 1: Write the failing tests**

Add coverage for:

- module registry containing the new module
- handover-system page rendering the reused `样品流程管理` panel

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/modules.structure.test.js src/modules/handover-system/page.runtime.test.js
```

Expected: FAIL because the module and page do not exist yet.

- [ ] **Step 3: Write minimal implementation**

Implement:

- module registration
- page shell
- panel reuse inside the new page

- [ ] **Step 4: Run test to verify it passes**

Run the same command again.

Expected: PASS

## Chunk 4: Focused Regression

### Task 4: Re-run central and handover regressions

**Files:**
- Test: `frontend/src/modules/samples/page.runtime.test.js`
- Test: `frontend/src/modules/handover-system/page.runtime.test.js`
- Test: `frontend/src/auth.test.js`
- Test: `frontend/src/modules/login/useLoginForm.test.js`
- Test: `frontend/src/modules/modules.structure.test.js`

- [ ] **Step 1: Run the focused regression suite**

Run:

```bash
npm --prefix frontend run test:run -- src/modules/samples/page.runtime.test.js src/modules/handover-system/page.runtime.test.js src/auth.test.js src/modules/login/useLoginForm.test.js src/modules/modules.structure.test.js
```

Expected: PASS

- [ ] **Step 2: Fix any regressions uncovered**

Keep fixes limited to login routing, module registration, and the shared sample-process panel.

- [ ] **Step 3: Re-run the same suite until green**

Run the same command again.

Expected: PASS

- [ ] **Step 4: Run diff hygiene**

Run:

```bash
git diff --check
```

Expected: no patch-format errors beyond known line-ending warnings.
