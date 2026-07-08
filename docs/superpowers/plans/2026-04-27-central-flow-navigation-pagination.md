# Central Flow Navigation Pagination Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update central navigation and labels, add sample pre-allocation and task history entries, make flow diagrams refresh from progress changes, and apply ellipsis pagination only when total pages exceed 10.

**Architecture:** Keep navigation changes in the existing module registry pattern by adding two focused modules and adjusting module order. Reuse `TransferWorkbench` for sample pre-allocation, add a read-only history page using existing task/storage APIs, and extend the existing `SAMPLES_UPDATED_EVENT` refresh path to flow-diagram pages. Keep pagination behavior centralized in `AppPagination` so the samples flow page benefits without page-specific branching.

**Tech Stack:** Vue 3, Vue Router, Vue Test Utils, Vitest, FastAPI-backed task/storage APIs

---

## Chunk 1: Labels And Navigation

### Task 1: Add failing coverage for central labels and navigation order

**Files:**
- Modify: `frontend/src/App.runtime.test.js`
- Modify: `frontend/src/modules/samples/index.js`
- Modify: `frontend/src/modules/dashboard/page.vue`

- [ ] **Step 1: Write the failing navigation test**

Add assertions that central navigation contains `样品预接驳`, `样品/托盘信息`, and `历史任务数据` in the required order:

```js
const navLabels = wrapper.findAll(".nav-link").map((node) => node.text());
expect(navLabels.indexOf("任务/托盘总览")).toBeLessThan(navLabels.indexOf("样品预接驳"));
expect(navLabels.indexOf("样品预接驳")).toBeLessThan(navLabels.indexOf("排程看板"));
expect(navLabels.indexOf("系统信息")).toBeLessThan(navLabels.indexOf("历史任务数据"));
expect(navLabels).toContain("样品/托盘信息");
expect(navLabels).not.toContain("样品/托盘管理");
```

- [ ] **Step 2: Write the failing dashboard label test**

Add or update a dashboard runtime assertion:

```js
expect(wrapper.text()).toContain("已受理任务");
expect(wrapper.text()).not.toContain("今日受理");
```

- [ ] **Step 3: Run the targeted tests and verify RED**

Run:

```bash
cd frontend
npm run test -- src/App.runtime.test.js src/modules/dashboard/page.runtime.test.js
```

Expected: failures for missing navigation entries and old labels.

### Task 2: Implement labels and module order

**Files:**
- Modify: `frontend/src/modules/index.js`
- Modify: `frontend/src/modules/dashboard/page.vue`
- Modify: `frontend/src/modules/samples/index.js`

- [ ] **Step 1: Change dashboard KPI text**

In `frontend/src/modules/dashboard/page.vue`, change only the label text:

```vue
<div class="muted">已受理任务</div>
```

- [ ] **Step 2: Rename samples module metadata**

In `frontend/src/modules/samples/index.js`, set:

```js
meta: {
  title: "样品/托盘信息",
  subtitle: "管理样品预分装、托盘状态、流转记录与暂存间派发。",
  module: "central",
},
```

- [ ] **Step 3: Prepare module registry insertion points**

Do not create the new module imports yet in this task unless the next task is being implemented immediately. The final order in `frontend/src/modules/index.js` must be:

```js
dashboardModule,
tasksModule,
taskOverviewModule,
samplePreAllocationModule,
scheduleModule,
samplesModule,
handoverSystemModule,
processModule,
devicesModule,
dataModule,
systemModule,
taskHistoryModule,
visualizationModule,
stagingManagementModule,
laboratoryModule,
```

- [ ] **Step 4: Re-run the targeted tests**

Run:

```bash
cd frontend
npm run test -- src/App.runtime.test.js src/modules/dashboard/page.runtime.test.js
```

Expected: dashboard and rename assertions pass after the new modules exist in later tasks.

## Chunk 2: Sample Pre-Allocation Module

### Task 3: Add failing route/module coverage for sample pre-allocation

**Files:**
- Modify: `frontend/src/router/index.structure.test.js`
- Modify: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Add route registration expectation**

Add a structure assertion that module registration includes a `sample-pre-allocation` module and route path `/sample-pre-allocation`.

- [ ] **Step 2: Add navigation expectation**

In `frontend/src/App.runtime.test.js`, assert `样品预接驳` is between `任务/托盘总览` and `排程看板`.

- [ ] **Step 3: Run and verify RED**

Run:

```bash
cd frontend
npm run test -- src/router/index.structure.test.js src/App.runtime.test.js
```

Expected: failures because the module does not exist yet.

### Task 4: Create sample pre-allocation module by reusing TransferWorkbench

**Files:**
- Create: `frontend/src/modules/sample-pre-allocation/index.js`
- Create: `frontend/src/modules/sample-pre-allocation/page.vue`
- Modify: `frontend/src/modules/index.js`

- [ ] **Step 1: Create the page**

`frontend/src/modules/sample-pre-allocation/page.vue`:

```vue
<template>
  <TransferWorkbench embedded mode="pre-allocation" />
</template>

<script setup>
import TransferWorkbench from "@/modules/transfer-workbench/TransferWorkbench.vue";
</script>
```

- [ ] **Step 2: Create the module index**

`frontend/src/modules/sample-pre-allocation/index.js`:

```js
import Page from "./page.vue";

export const route = {
  path: "/sample-pre-allocation",
  name: "sample-pre-allocation",
  component: Page,
  meta: {
    title: "样品预接驳",
    subtitle: "提前完成样品与托盘预分配，为后续接驳和实验流转做准备。",
    module: "central",
  },
};

export default {
  key: "sample-pre-allocation",
  nav: true,
  route,
};
```

- [ ] **Step 3: Register the module in order**

Import `samplePreAllocationModule` in `frontend/src/modules/index.js` and insert it after `taskOverviewModule`.

- [ ] **Step 4: Re-run route/nav tests**

Run:

```bash
cd frontend
npm run test -- src/router/index.structure.test.js src/App.runtime.test.js
```

Expected: new route and nav order pass.

## Chunk 3: Task History Module

### Task 5: Add failing coverage for history route and nav placement

**Files:**
- Modify: `frontend/src/router/index.structure.test.js`
- Modify: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Add route registration expectation**

Assert route path `/task-history`, route name `task-history`, and title `历史任务数据`.

- [ ] **Step 2: Add nav placement expectation**

Assert `系统信息` appears before `历史任务数据`.

- [ ] **Step 3: Run and verify RED**

Run:

```bash
cd frontend
npm run test -- src/router/index.structure.test.js src/App.runtime.test.js
```

Expected: failures because the module does not exist yet.

### Task 6: Create read-only task history page

**Files:**
- Create: `frontend/src/modules/task-history/index.js`
- Create: `frontend/src/modules/task-history/page.vue`
- Modify: `frontend/src/modules/index.js`

- [ ] **Step 1: Create module index**

`frontend/src/modules/task-history/index.js`:

```js
import Page from "./page.vue";

export const route = {
  path: "/task-history",
  name: "task-history",
  component: Page,
  meta: {
    title: "历史任务数据",
    subtitle: "查看已受理任务的历史状态、更新时间与样品流转摘要。",
    module: "central",
  },
};

export default {
  key: "task-history",
  nav: true,
  route,
};
```

- [ ] **Step 2: Create a minimal read-only page**

Use existing `readTasks()` from `@/lib/tasksApi` and render a read-only table with columns: `任务编号`, `任务名称`, `状态`, `更新时间`.

- [ ] **Step 3: Register after system module**

Import `taskHistoryModule` and insert it immediately after `systemModule` in `frontend/src/modules/index.js`.

- [ ] **Step 4: Re-run route/nav tests**

Run:

```bash
cd frontend
npm run test -- src/router/index.structure.test.js src/App.runtime.test.js
```

Expected: route and nav placement pass.

## Chunk 4: Pagination C Scheme

### Task 7: Add failing tests for conditional ellipsis pagination

**Files:**
- Modify: `frontend/src/components/shared/AppPagination.test.js`

- [ ] **Step 1: Preserve full display for 10 pages**

Add a test:

```js
const wrapper = mount(AppPagination, {
  props: { currentPage: 5, pageCount: 10 },
});

expect(wrapper.findAll("button[data-page]").map((node) => node.attributes("data-page"))).toEqual([
  "prev", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "next",
]);
expect(wrapper.text()).not.toContain("...");
```

- [ ] **Step 2: Add C scheme test for page 15 of 23**

```js
const wrapper = mount(AppPagination, {
  props: { currentPage: 15, pageCount: 23 },
});

expect(wrapper.text()).toContain("1");
expect(wrapper.text()).toContain("13");
expect(wrapper.text()).toContain("14");
expect(wrapper.text()).toContain("15");
expect(wrapper.text()).toContain("16");
expect(wrapper.text()).toContain("17");
expect(wrapper.text()).toContain("23");
expect(wrapper.findAll('[data-page="ellipsis"]')).toHaveLength(2);
```

- [ ] **Step 3: Add C scheme test near the end**

```js
const wrapper = mount(AppPagination, {
  props: { currentPage: 21, pageCount: 23 },
});

expect(wrapper.text()).toContain("1");
expect(wrapper.text()).toContain("19");
expect(wrapper.text()).toContain("20");
expect(wrapper.text()).toContain("21");
expect(wrapper.text()).toContain("22");
expect(wrapper.text()).toContain("23");
expect(wrapper.findAll('[data-page="ellipsis"]')).toHaveLength(1);
```

- [ ] **Step 4: Run and verify RED**

Run:

```bash
cd frontend
npm run test -- src/components/shared/AppPagination.test.js
```

Expected: failures because all pages are currently rendered.

### Task 8: Implement conditional pagination display

**Files:**
- Modify: `frontend/src/components/shared/AppPagination.vue`

- [ ] **Step 1: Replace numeric-only page list with page items**

Use items shaped like `{ type: "page", value: 15, key: "page-15" }` and `{ type: "ellipsis", key: "ellipsis-end" }`.

- [ ] **Step 2: Keep current full display when `pageCount <= 10`**

Return all pages exactly as the component does today.

- [ ] **Step 3: Implement C scheme when `pageCount > 10`**

Use:

```js
const visibleStart = Math.max(2, Math.min(current - 2, total - 4));
const visibleEnd = Math.min(total - 1, Math.max(current + 2, 5));
```

Then render first page, optional start ellipsis, visible middle range, optional end ellipsis, and last page.

- [ ] **Step 4: Render ellipsis as disabled text**

Use a non-clickable element:

```vue
<span class="page-ellipsis" data-page="ellipsis">...</span>
```

- [ ] **Step 5: Re-run pagination tests**

Run:

```bash
cd frontend
npm run test -- src/components/shared/AppPagination.test.js
```

Expected: all pagination tests pass.

## Chunk 5: Flow Diagram Realtime Refresh

### Task 9: Add failing tests for process page event refresh

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.test.js`

- [ ] **Step 1: Add a test that mounts the composable with `autoLoad: true`**

Use fake timers or a simple event dispatch. Assert `loadSnapshot` is called again when `SAMPLES_UPDATED_EVENT` is dispatched.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd frontend
npm run test -- src/modules/process/useProcessLabs.test.js
```

Expected: event refresh test fails before listener is added.

### Task 10: Implement process page refresh listener

**Files:**
- Modify: `frontend/src/modules/process/useProcessLabs.js`

- [ ] **Step 1: Import lifecycle hooks**

Change:

```js
import { computed, onMounted, ref } from "vue";
```

to:

```js
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
```

- [ ] **Step 2: Add event listener in `onMounted`**

When `autoLoad` is true, call `loadLabStatus()` on mount and add:

```js
window.addEventListener(SAMPLES_UPDATED_EVENT, loadLabStatus);
```

- [ ] **Step 3: Remove listener in `onBeforeUnmount`**

Guard for `typeof window !== "undefined"` and remove the listener.

- [ ] **Step 4: Re-run process tests**

Run:

```bash
cd frontend
npm run test -- src/modules/process/useProcessLabs.test.js
```

Expected: process event refresh test passes and existing behavior remains green.

### Task 11: Add failing tests for laboratory event refresh

**Files:**
- Modify: `frontend/src/modules/laboratory/page.runtime.test.js`

- [ ] **Step 1: Add runtime assertion**

After mounting the page, dispatch `new CustomEvent(SAMPLES_UPDATED_EVENT)` and assert storage fetch is called again or rendered flow text updates from changed test storage.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
cd frontend
npm run test -- src/modules/laboratory/page.runtime.test.js
```

Expected: failure because laboratory page only loads once today.

### Task 12: Implement laboratory page refresh listener

**Files:**
- Modify: `frontend/src/modules/laboratory/useLaboratoryPage.js`

- [ ] **Step 1: Add event listener in mounted block**

Inside the existing `onMounted`, add:

```js
window.addEventListener(SAMPLES_UPDATED_EVENT, load);
```

- [ ] **Step 2: Remove event listener in unmount block**

Inside `onBeforeUnmount`, add:

```js
window.removeEventListener(SAMPLES_UPDATED_EVENT, load);
```

- [ ] **Step 3: Re-run laboratory tests**

Run:

```bash
cd frontend
npm run test -- src/modules/laboratory/page.runtime.test.js
```

Expected: laboratory flow refresh test passes and existing event dispatch assertions remain valid.

## Chunk 6: Final Verification

### Task 13: Run targeted regression suite

**Files:**
- Verify only

- [ ] **Step 1: Run frontend targeted tests**

Run:

```bash
cd frontend
npm run test -- src/App.runtime.test.js src/router/index.structure.test.js src/modules/dashboard/page.runtime.test.js src/components/shared/AppPagination.test.js src/modules/process/useProcessLabs.test.js src/modules/laboratory/page.runtime.test.js
```

Expected: all targeted tests pass.

- [ ] **Step 2: Start local frontend for manual spot check**

Run:

```bash
cd frontend
npm run dev -- --host 127.0.0.1
```

Expected: Vite prints a local URL.

- [ ] **Step 3: Manually verify UI**

Open the local URL and check:

- `已受理任务` appears on 中控总览.
- Navigation order is `任务/托盘总览` -> `样品预接驳` -> `排程看板`.
- `系统信息` is followed by `历史任务数据`.
- `样品/托盘信息` is shown instead of `样品/托盘管理`.
- A sample flow page with more than 10 pages uses C scheme; 10 pages or fewer show all page numbers.

- [ ] **Step 4: Report verification evidence**

Summarize commands run, pass/fail status, and any manual checks that could not be completed.
