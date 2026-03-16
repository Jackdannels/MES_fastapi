# Samples Process Vue3 Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the `样品流程管理 / 托盘分装 / 编码打印` block on `SamplesPage` to native Vue3 while preserving existing storage updates and operator behavior.

**Architecture:** Extract the tray-planning and intake confirmation rules into a pure model, wrap them with a Vue composable for snapshot-backed state, then render only this block through Vue while leaving the other `SamplesPage` sections temporarily unchanged. Keep printing behavior and storage schema aligned with the legacy implementation.

**Tech Stack:** Vue 3, Vitest, Vue Test Utils, localStorage snapshot composables

---

## Chunk 1: Model + Vue integration for samples process

### Task 1: Lock tray planning and intake rules in a pure model test suite

**Files:**
- Create: `frontend/src/lib/samplesProcessModel.test.js`
- Spec: `docs/superpowers/specs/2026-03-13-samples-process-vue3-design.md`

- [ ] **Step 1: Write the failing unit tests**

```js
import {
  buildSampleProcessTaskOptions,
  selectTaskProcessDraft,
  moveSampleBetweenTrays,
  confirmSampleTaskStore,
  buildTrayPrintPayload,
} from "./samplesProcessModel";

test("selectTaskProcessDraft loads sample codes and default tray layout for a task", () => {
  const draft = selectTaskProcessDraft({
    taskCode: "SZH-2026-001",
    tasks: [{ code: "SZH-2026-001", sample_count: "4" }],
    samples: [],
  });
  expect(draft.sampleCodes).toEqual([
    "SZH-2026-001-SP-001",
    "SZH-2026-001-SP-002",
    "SZH-2026-001-SP-003",
    "SZH-2026-001-SP-004",
  ]);
  expect(draft.trays.length).toBeGreaterThanOrEqual(2);
});
```

```js
test("confirmSampleTaskStore writes trays back to samples and task tray codes", () => {
  const result = confirmSampleTaskStore({
    taskCode: "SZH-2026-001",
    tasks: [{ code: "SZH-2026-001", sample_count: "2" }],
    samples: [],
    trayDraft: {
      maxPerTray: 5,
      sampleCodes: ["SZH-2026-001-SP-001", "SZH-2026-001-SP-002"],
      trays: [
        { trayCode: "SZH-2026-001-TP-001", samples: ["SZH-2026-001-SP-001"] },
        { trayCode: "SZH-2026-001-TP-002", samples: ["SZH-2026-001-SP-002"] },
      ],
    },
    labels: { intakeLocation: "接驳区", sampleStored: "已入库" },
  });
  expect(result.tasks[0].tray_codes).toEqual(["SZH-2026-001-TP-001", "SZH-2026-001-TP-002"]);
  expect(result.samples).toHaveLength(2);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:run -- src/lib/samplesProcessModel.test.js`
Expected: FAIL because the model does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export function buildSampleProcessTaskOptions(input) {}
export function selectTaskProcessDraft(input) {}
export function moveSampleBetweenTrays(input) {}
export function confirmSampleTaskStore(input) {}
export function buildTrayPrintPayload(input) {}
```

Keep all tray planning and store confirmation logic pure.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:run -- src/lib/samplesProcessModel.test.js`
Expected: PASS

### Task 2: Render sample process block from Vue state and preserve print flow

**Files:**
- Create: `frontend/src/composables/useSamplesProcess.js`
- Create: `frontend/src/pages/SamplesPage.runtime.test.js`
- Modify: `frontend/src/pages/SamplesPage.vue`
- Test: `frontend/src/lib/samplesProcessModel.test.js`

- [ ] **Step 1: Write the failing runtime tests**

```js
import { mount } from "@vue/test-utils";
import SamplesPage from "./SamplesPage.vue";

test("selecting a task populates sample count, sample codes, and tray preview from Vue state", async () => {
  const wrapper = mount(SamplesPage);
  await wrapper.get('[data-testid="samples-process-task-select"]').setValue("SZH-2026-001");
  expect(wrapper.text()).toContain("SZH-2026-001-SP-001");
});
```

```js
test("confirming storage enables tray printing and persists sample trays", async () => {
  const wrapper = mount(SamplesPage);
  await wrapper.get('[data-testid="samples-process-store"]').trigger("click");
  expect(wrapper.get('[data-testid="samples-process-print"]').attributes("disabled")).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npm run test:run -- src/pages/SamplesPage.runtime.test.js`
Expected: FAIL because this block still relies on legacy DOM scripts.

- [ ] **Step 3: Write minimal implementation**

```js
export function useSamplesProcess() {
  // load tasks/samples snapshot, expose task selection, tray actions,
  // confirm storage, print payload, and warning state
}
```

Render the process block, tray cards, preview, and action buttons from Vue. Keep the other page sections untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npm run test:run -- src/pages/SamplesPage.runtime.test.js`
Expected: PASS

### Task 3: Run focused regression for the migrated block

**Files:**
- Test: `frontend/src/lib/samplesProcessModel.test.js`
- Test: `frontend/src/pages/SamplesPage.runtime.test.js`
- Build: `frontend/src/pages/SamplesPage.vue`

- [ ] **Step 1: Run focused tests**

Run: `cd frontend && npm run test:run -- src/lib/samplesProcessModel.test.js src/pages/SamplesPage.runtime.test.js`
Expected: PASS

- [ ] **Step 2: Run broader regression touching shared app wiring**

Run: `cd frontend && npm run test:run -- src/App.runtime.test.js src/lib/appConfig.test.js src/router/index.structure.test.js src/lib/samplesProcessModel.test.js src/pages/SamplesPage.runtime.test.js`
Expected: PASS

- [ ] **Step 3: Run production build**

Run: `cd frontend && npm run build`
Expected: PASS
