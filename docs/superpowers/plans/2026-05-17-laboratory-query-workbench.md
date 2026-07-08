# 试验室操作台二级选择 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generalize the salt-spray laboratory console into a shared laboratory workbench selected by `/laboratory?lab=<实验室名称>`.

**Architecture:** Keep one auth/module key, `laboratory`, and represent the selected laboratory as query state plus per-browser default storage. The existing laboratory model remains the shared workflow engine; implementation removes salt-spray defaults from callers and feeds a selected lab config into the existing `labName` filtering path.

**Tech Stack:** Vue 3, Vue Router, Vitest, existing storage snapshot APIs, existing master-data APIs.

---

## Chunk 1: Module Entry And Dialog

### Task 1: Add the laboratory catalog and two-level exit dialog

**Files:**
- Modify: `frontend/src/lib/moduleCatalog.js`
- Modify: `frontend/src/components/shared/ModuleExitDialog.vue`
- Modify: `frontend/src/components/shared/ModuleExitDialog.test.js`

- [ ] **Step 1: Write failing catalog/dialog tests**

Add tests proving:
- `MODULE_LABELS.laboratory` is `试验室操作台`.
- laboratory sub-options are ordered as the user specified.
- choosing `laboratory` reveals a second select.
- switching emits `{ module: "laboratory", labName: "冲击一室" }`.
- choosing the current same lab shows `请选择其他界面`.

Run: `rtk npm run test:run -- src/components/shared/ModuleExitDialog.test.js`
Expected: FAIL before implementation.

- [ ] **Step 2: Implement catalog exports and dialog behavior**

Add `LABORATORY_MODULE_OPTIONS` to `moduleCatalog.js`. Update `ModuleExitDialog.vue` to track `selectedModule` and `selectedLaboratory`, render the second select only for `laboratory`, and emit structured payloads.

- [ ] **Step 3: Run focused tests**

Run: `rtk npm run test:run -- src/components/shared/ModuleExitDialog.test.js`
Expected: PASS.

## Chunk 2: App Routing

### Task 2: Route laboratory selections through query state

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/App.runtime.test.js`
- Modify: `frontend/src/modules/laboratory/index.js`

- [ ] **Step 1: Write failing App runtime tests**

Add tests proving:
- laboratory shell title is generic `试验室操作台`.
- switching to `试验室操作台 -> 冲击一室` calls `switchSessionModule("laboratory")`.
- router receives `{ path: "/laboratory", query: { lab: "冲击一室" } }`.

Run: `rtk npm run test:run -- src/App.runtime.test.js`
Expected: FAIL before implementation.

- [ ] **Step 2: Implement App switch payload handling**

Adapt `switchModule` to accept either a string or `{ module, labName }`. Preserve old behavior for non-laboratory modules. Pass current route lab query into the dialog.

- [ ] **Step 3: Update laboratory route meta**

Change route title/subtitle to generic `试验室操作台`.

- [ ] **Step 4: Run focused tests**

Run: `rtk npm run test:run -- src/App.runtime.test.js`
Expected: PASS.

## Chunk 3: Laboratory Selection And Workflow

### Task 3: Resolve current lab config from query/master data/local default

**Files:**
- Modify: `frontend/src/modules/laboratory/model.js`
- Modify: `frontend/src/modules/laboratory/model.test.js`
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`
- Modify: `frontend/src/modules/laboratory/page.vue`
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`
- Modify: `frontend/src/modules/laboratory/styles.css`

- [ ] **Step 1: Write failing model tests**

Add a non-salt test with `labName: "振动一室"` and mixed schedules. Assert only `振动一室` rows appear and the active current task is selected. Add a progress-message test proving no-task text uses the current lab name.

Run: `rtk npm run test:run -- src/modules/laboratory/model.test.js`
Expected: FAIL before implementation.

- [ ] **Step 2: Implement model generalization**

Rename or alias `buildSaltSprayLaboratoryView` to a generic export while preserving backward compatibility. Remove salt-spray text defaults where current lab can be supplied. `buildLaboratoryProgressMessage` should accept `labName`.

- [ ] **Step 3: Write failing runtime tests**

Set route query `lab=冲击一室` and master labs containing `LAB_IMPACT_1`. Assert the page renders `冲击一室操作台`, filters to `冲击一室`, and MQ payload uses the current lab id/code rather than `salt-spray-lab-01`.

Run: `rtk npm run test:run -- src/modules/laboratory/page.runtime.test.js`
Expected: FAIL before implementation.

- [ ] **Step 4: Implement query/local default config**

Use `useRoute()` in `page.vue` or `useLaboratoryPage` options to pass selected lab. Resolve against master labs first, static fallback second. Store selected lab name in localStorage and use it when `/laboratory` has no `lab`.

- [ ] **Step 5: Reset per-lab transient state**

Watch selected lab identity and clear task/tray/scan/modal/timer/full-content state when it changes.

- [ ] **Step 6: Add small style protections**

Add wrapping/min-width guards for long lab names and optional lab selector text.

- [ ] **Step 7: Run focused laboratory tests**

Run: `rtk npm run test:run -- src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js`
Expected: PASS.

## Chunk 4: Regression Verification

### Task 4: Verify affected front-end suites

**Files:**
- No production files unless failures reveal required fixes.

- [ ] **Step 1: Run module and auth focused tests**

Run: `rtk npm run test:run -- src/components/shared/ModuleExitDialog.test.js src/App.runtime.test.js src/auth.test.js src/lib/authRouting.test.js src/modules/modules.structure.test.js src/router/index.structure.test.js`
Expected: PASS.

- [ ] **Step 2: Run laboratory focused tests**

Run: `rtk npm run test:run -- src/modules/laboratory/model.test.js src/modules/laboratory/page.runtime.test.js`
Expected: PASS.

- [ ] **Step 3: Run build or broader test command if focused tests pass**

Run: `rtk npm run build`
Expected: PASS.
