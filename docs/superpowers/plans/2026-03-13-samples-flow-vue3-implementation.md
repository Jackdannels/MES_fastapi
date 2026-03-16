# Samples Flow Vue3 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `样品流转与状态` block on `SamplesPage` to native Vue3 while preserving local storage behavior and operator workflows.

**Architecture:** Extract filtering, sorting, paging, batch intake, and detail editing rules into a pure model, then wrap them with a Vue composable that owns table state, modal state, and drawer state. Render only the `样品流转与状态` block, batch modal, and sample detail drawer from Vue while leaving `暂存间` and `全生命周期追踪` temporarily on the legacy runtime.

**Tech Stack:** Vue 3, Vitest, Vue Test Utils, localStorage-backed composables

---

## Chunk 1: Samples flow table, batch intake, and detail drawer

### Task 1: Lock sample flow table behavior in model tests

**Files:**
- Create: `frontend/src/lib/samplesFlowModel.js`
- Create: `frontend/src/lib/samplesFlowModel.test.js`
- Reference: `frontend/src/legacy/runtime/render.js`
- Reference: `frontend/src/legacy/runtime/actions.js`

- [ ] **Step 1: Write the failing unit tests**

```js
import {
  buildSamplesFlowView,
  submitSamplesBatchIntake,
  updateSampleDetail,
} from "./samplesFlowModel";

test("buildSamplesFlowView filters, sorts, and paginates samples", () => {
  const view = buildSamplesFlowView({
    samples: [
      { code: "SP-002", task_code: "SZH-2", status: "已接收", location: "接驳区", owner: "张三" },
      { code: "SP-001", task_code: "SZH-1", status: "试验中", location: "振动一室", owner: "李四" },
    ],
    filters: { query: "SP-00", taskCode: "", status: "" },
    sort: { key: "code", direction: "asc" },
    page: 1,
    pageSize: 8,
  });
  expect(view.rows[0].code).toBe("SP-001");
});
```

```js
test("submitSamplesBatchIntake writes location owner and status to matching samples", () => {
  const result = submitSamplesBatchIntake({
    samples: [{ code: "SP-001", task_code: "SZH-1", status: "运输中", location: "", owner: "" }],
    payload: { location: "接驳区", owner: "王工", codes: "SP-001" },
    labels: { intakeLocation: "接驳区", sampleReceived: "已接收", sampleStored: "已入库" },
    now: "2026-03-13T10:00:00.000Z",
  });
  expect(result.samples[0].location).toBe("接驳区");
  expect(result.samples[0].owner).toBe("王工");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- src/lib/samplesFlowModel.test.js`
Expected: FAIL because the model does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export function buildSamplesFlowView(input) {}
export function submitSamplesBatchIntake(input) {}
export function updateSampleDetail(input) {}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- src/lib/samplesFlowModel.test.js`
Expected: PASS

### Task 2: Render sample flow table and dialogs from Vue state

**Files:**
- Create: `frontend/src/composables/useSamplesFlow.js`
- Modify: `frontend/src/pages/SamplesPage.vue`
- Modify: `frontend/src/pages/SamplesPage.runtime.test.js`
- Reference: `frontend/src/components/shared/AppModal.vue`
- Reference: `frontend/src/components/shared/AppDrawer.vue`

- [ ] **Step 1: Write the failing runtime tests**

```js
test("sample flow search and filters update rows from Vue state", async () => {
  const wrapper = mount(SamplesPage);
  await wrapper.get('[data-testid="samples-flow-search"]').setValue("SP-001");
  expect(wrapper.text()).toContain("SP-001");
});
```

```js
test("batch intake updates sample rows and detail drawer saves edits", async () => {
  const wrapper = mount(SamplesPage);
  await wrapper.get('[data-testid="samples-flow-open-batch"]').trigger("click");
  await wrapper.get('[data-testid="samples-flow-batch-codes"]').setValue("SP-001");
  await wrapper.get('[data-testid="samples-flow-batch-submit"]').trigger("click");
  expect(wrapper.text()).toContain("接驳区");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm run test:run -- src/pages/SamplesPage.runtime.test.js`
Expected: FAIL because this block still relies on legacy DOM rendering.

- [ ] **Step 3: Write minimal implementation**

```js
export function useSamplesFlow() {
  // load samples/tasks snapshot, expose filters, paging, batch intake,
  // selected sample detail, and save handlers
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm run test:run -- src/pages/SamplesPage.runtime.test.js`
Expected: PASS

### Task 3: Run focused regression for the migrated block

**Files:**
- Test: `frontend/src/lib/samplesFlowModel.test.js`
- Test: `frontend/src/pages/SamplesPage.runtime.test.js`
- Build: `frontend/src/pages/SamplesPage.vue`

- [ ] **Step 1: Run focused tests**

Run: `cd frontend && npm run test:run -- src/lib/samplesFlowModel.test.js src/pages/SamplesPage.runtime.test.js`
Expected: PASS

- [ ] **Step 2: Run broader shared-app regression**

Run: `cd frontend && npm run test:run -- src/App.runtime.test.js src/lib/appConfig.test.js src/router/index.structure.test.js src/lib/samplesProcessModel.test.js src/lib/samplesFlowModel.test.js src/pages/SamplesPage.runtime.test.js`
Expected: PASS

- [ ] **Step 3: Run production build**

Run: `cd frontend && npm run build`
Expected: PASS
