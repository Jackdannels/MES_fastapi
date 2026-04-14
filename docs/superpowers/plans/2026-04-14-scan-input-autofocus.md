# 扫码流程输入框自动聚焦 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dedicated scan inputs enter input mode automatically when the user opens the corresponding scan flow, without adding page-level autofocus to ordinary inputs.

**Architecture:** Add one lightweight focus helper in `frontend/src/composables` that waits for the DOM tick and focuses a provided input ref when it is available. Reuse that helper in the laboratory compare modal, staging scan modal, and transfer dispatch panel so each module keeps explicit ownership of its own scan trigger while sharing the same safe focus behavior.

**Tech Stack:** Vue 3 Composition API, Vue Test Utils, Vitest

---

## Chunk 1: Shared Scan Focus Helper

### Task 1: Add the reusable helper that focuses a scan input ref after render

**Files:**
- Create: `frontend/src/composables/useScanInputFocus.js`
- Modify: `frontend/src/modules/staging-management/page.vue`

- [ ] **Step 1: Write the failing test anchor**

Keep `frontend/src/modules/staging-management/page.runtime.test.js` as the initial safety net because it already proves the scan modal opens with focus on `zancun-scan-code`.

- [ ] **Step 2: Run the existing staging focus test before refactor**

Run: `npm run test:run -- src/modules/staging-management/page.runtime.test.js -t "tray rows are display-only and scan buttons open directly into focused edit mode"`
Expected: PASS, confirming the current behavior to preserve.

- [ ] **Step 3: Write the helper and refactor staging to use it**

Create `frontend/src/composables/useScanInputFocus.js` with a small composable that:

```js
import { nextTick } from "vue";

export const useScanInputFocus = (inputRef) => {
  const focusScanInput = async () => {
    await nextTick();
    const element = inputRef?.value;
    if (!element || element.disabled) {
      return false;
    }
    element.focus?.();
    return document.activeElement === element;
  };

  return {
    focusScanInput,
  };
};
```

Update `frontend/src/modules/staging-management/page.vue` to import this composable and replace the inline `nextTick + focus()` implementation with the shared helper.

- [ ] **Step 4: Run the staging focus test again**

Run: `npm run test:run -- src/modules/staging-management/page.runtime.test.js -t "tray rows are display-only and scan buttons open directly into focused edit mode"`
Expected: PASS

## Chunk 2: Salt-Spray Laboratory Compare Modal

### Task 2: Add runtime coverage for auto-focusing the compare scan input

**Files:**
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`
- Modify: `frontend/src/modules/laboratory/page.vue`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`

- [ ] **Step 1: Write the failing runtime test**

Add a test proving:
- clicking `data-testid="laboratory-compare"` opens the modal
- after render, `data-testid="laboratory-compare-scan-input"` is `document.activeElement`

- [ ] **Step 2: Run the targeted laboratory runtime test to verify it fails**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js -t "auto focuses the compare scan input when the compare modal opens"`
Expected: FAIL because the compare input currently has no ref or focus hook.

- [ ] **Step 3: Write the minimal implementation**

Update the laboratory module so that:
- `page.vue` adds a template ref on `laboratory-compare-scan-input`
- `useLaboratoryPage.js` owns the ref and calls the shared `focusScanInput()` helper from `openCompare()` after `compareModalOpen.value = true`
- closing the modal does not try to refocus anything else

- [ ] **Step 4: Run the targeted laboratory runtime test again**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js -t "auto focuses the compare scan input when the compare modal opens"`
Expected: PASS

## Chunk 3: Transfer Dispatch Panel

### Task 3: Add runtime coverage and autofocus for handover dispatch scanning

**Files:**
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
- Modify: `frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue`
- Modify: `frontend/src/modules/transfer-workbench/TransferWorkbench.vue`

- [ ] **Step 1: Write the failing runtime test**

Extend the handover dispatch runtime coverage to prove:
- switching to `handover-nav-dispatch` renders `transfer-dispatch-panel`
- `data-testid="transfer-dispatch-scan-input"` becomes `document.activeElement` once the dispatch view is active

- [ ] **Step 2: Run the targeted transfer runtime test to verify it fails**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js -t "handover dispatch view auto focuses the tray scan input"`
Expected: FAIL because the dispatch panel currently renders the input without a focus hook.

- [ ] **Step 3: Write the minimal implementation**

Choose the least coupled trigger:
- if the dispatch panel is mounted only when dispatch view is active, add an input ref in `TransferDispatchPanel.vue` and focus it on mount with the shared helper
- if remount timing is unreliable, pass a simple `autofocusKey` or `active` prop from `TransferWorkbench.vue` and watch it in the panel to re-focus when the view switches to dispatch

The finished behavior must autofocus only when the dispatch flow becomes active, not while the overview is visible.

- [ ] **Step 4: Run the targeted transfer runtime test again**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js -t "handover dispatch view auto focuses the tray scan input"`
Expected: PASS

## Chunk 4: Focused Regression Verification

### Task 4: Run the dedicated scan-flow verification set

**Files:**
- Verify only

- [ ] **Step 1: Run laboratory runtime verification**

Run: `npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: PASS

- [ ] **Step 2: Run staging runtime verification**

Run: `npm run test:run -- src/modules/staging-management/page.runtime.test.js`
Expected: PASS

- [ ] **Step 3: Run transfer runtime verification**

Run: `npm run test:run -- src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
Expected: PASS

- [ ] **Step 4: Review the final diff scope**

Run: `git diff --stat -- frontend/src/composables/useScanInputFocus.js frontend/src/modules/laboratory/page.vue frontend/src/modules/laboratory/useLaboratoryPage.js frontend/src/modules/laboratory/page.runtime.test.js frontend/src/modules/staging-management/page.vue frontend/src/modules/staging-management/page.runtime.test.js frontend/src/modules/transfer-workbench/TransferDispatchPanel.vue frontend/src/modules/transfer-workbench/TransferWorkbench.vue frontend/src/modules/transfer-workbench/TransferWorkbench.runtime.test.js`
Expected: only the shared helper and the three scan-flow modules are listed.
