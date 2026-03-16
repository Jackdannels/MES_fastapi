# Vue3 Legacy Page Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将剩余 7 个依赖 legacy bridge 的页面全部替换为原生 Vue 3 页面，同时尽量保持现有页面样式、路由结构、交互路径和业务结果不变。

**Architecture:** 采用“共享交互基建先行、低风险页面先迁、中风险页面复用模式、高风险页面最后收口”的四阶段迁移策略。每个页面统一拆成纯数据模型、页面 composable、Vue 页面模板三层；通用的模态框、抽屉、表格过滤/排序/分页、Tab 状态先抽成共享单元，避免每页重复重写并降低样式漂移风险。legacy bridge 在最后一阶段统一移除，确保前几阶段都可回滚。

**Tech Stack:** Vue 3, Vue Router, Vite, Vitest, `@vue/test-utils`, existing `useStorageSnapshot`, existing `mes-app.css`

---

## Scope and Constraints

- 当前仍依赖 legacy bridge 的页面为：`dashboard`、`tasks`、`schedule`、`samples`、`devices`、`data`、`system`；见 `frontend/src/lib/appConfig.js`。
- 当前 legacy 运行时主要集中在 `frontend/src/legacy/runtime/actions.js` 与 `frontend/src/legacy/runtime/render.js`。
- `ProcessPage` 与 `TaskOverviewPage` 已经是更接近目标态的参考实现，应优先复用其 composable + model 拆分方式。
- 样式入口已经在前端内聚到 `frontend/src/assets/app.css` 与 `frontend/src/assets/mes-app.css`，迁移时禁止重新设计视觉样式。
- 本计划默认保留页面 URL、标题、导航层级、按钮文案、表单字段名、主要 DOM class 名称不变，除非测试明确证明需要调整。

## Target File Structure

### Shared Vue Primitives

- Create: `frontend/src/components/shared/AppModal.vue`
  Purpose: 统一 modal 打开/关闭、遮罩、标题和 footer 插槽，替代 `data-modal-open` / `data-modal-close` DOM 事件委托。
- Create: `frontend/src/components/shared/AppDrawer.vue`
  Purpose: 统一 drawer 打开/关闭、遮罩和头部布局，替代 `data-drawer-open` / `data-drawer-close`。
- Create: `frontend/src/composables/useDialogState.js`
  Purpose: 管理 modal / drawer 的显隐状态与当前编辑实体。
- Create: `frontend/src/composables/useTableControls.js`
  Purpose: 统一表格搜索、排序、分页、筛选状态，替代 `data-filter-input` 与 `data-sortable`。
- Create: `frontend/src/composables/useTabState.js`
  Purpose: 管理排程页 Tab 状态，替代 `data-tab-role="tabs"` 的 DOM 绑定。
- Create: `frontend/src/components/shared/AppPagination.vue`
  Purpose: 统一分页按钮渲染，替代 legacy `innerHTML` 拼接分页条。

### Page Units

- Create: `frontend/src/lib/dashboardPageModel.js`
- Create: `frontend/src/composables/useDashboardPage.js`
- Modify: `frontend/src/pages/DashboardPage.vue`

- Create: `frontend/src/lib/systemPageModel.js`
- Create: `frontend/src/composables/useSystemPage.js`
- Modify: `frontend/src/pages/SystemPage.vue`

- Create: `frontend/src/lib/dataPageModel.js`
- Create: `frontend/src/composables/useDataPage.js`
- Modify: `frontend/src/pages/DataPage.vue`

- Create: `frontend/src/lib/devicesPageModel.js`
- Create: `frontend/src/composables/useDevicesPage.js`
- Modify: `frontend/src/pages/DevicesPage.vue`

- Create: `frontend/src/lib/tasksPageModel.js`
- Create: `frontend/src/composables/useTasksPage.js`
- Modify: `frontend/src/pages/TasksPage.vue`

- Create: `frontend/src/lib/schedulePageModel.js`
- Create: `frontend/src/composables/useSchedulePage.js`
- Modify: `frontend/src/pages/SchedulePage.vue`

- Create: `frontend/src/lib/samplesPageModel.js`
- Create: `frontend/src/composables/useSamplesPage.js`
- Modify: `frontend/src/pages/SamplesPage.vue`

### Integration and Cleanup

- Modify: `frontend/src/App.vue`
  Purpose: 在所有 legacy 页面完成迁移后删除 `bootLegacyUI()` 调用。
- Modify: `frontend/src/lib/appConfig.js`
  Purpose: 逐步收缩并最终删除 `legacyUiRoutes` 与 `enableLegacyUiBridge`。
- Modify or Delete later: `frontend/src/legacy/boot.js`
- Delete later: `frontend/src/legacy/runtime/*`
- Modify: `frontend/src/router/index.js`
  Purpose: 删除页面 `meta.legacyUi` 标记。
- Modify: `README.md`
  Purpose: 记录页面迁移完成后不再依赖 legacy runtime。

### Tests

- Create: `frontend/src/components/shared/AppModal.test.js`
- Create: `frontend/src/components/shared/AppDrawer.test.js`
- Create: `frontend/src/components/shared/AppPagination.test.js`
- Create: `frontend/src/composables/useTableControls.test.js`
- Create: `frontend/src/composables/useTabState.test.js`
- Create: `frontend/src/composables/useDialogState.test.js`
- Create: `frontend/src/pages/DashboardPage.runtime.test.js`
- Create: `frontend/src/pages/SystemPage.runtime.test.js`
- Create: `frontend/src/pages/DataPage.runtime.test.js`
- Create: `frontend/src/pages/DevicesPage.runtime.test.js`
- Create: `frontend/src/pages/TasksPage.runtime.test.js`
- Create: `frontend/src/pages/SchedulePage.runtime.test.js`
- Create: `frontend/src/pages/SamplesPage.runtime.test.js`
- Modify: `frontend/src/App.runtime.test.js`

---

## Chunk 1: Build Shared Vue Interaction Primitives

### Task 1: Add shared modal and drawer components

**Files:**
- Create: `frontend/src/components/shared/AppModal.vue`
- Create: `frontend/src/components/shared/AppDrawer.vue`
- Create: `frontend/src/components/shared/AppModal.test.js`
- Create: `frontend/src/components/shared/AppDrawer.test.js`

- [ ] **Step 1: Write the failing component tests**

```js
import { mount } from "@vue/test-utils";
import AppModal from "./AppModal.vue";

test("emits close when backdrop is clicked", async () => {
  const wrapper = mount(AppModal, { props: { open: true, title: "Test" } });
  await wrapper.find(".modal-backdrop").trigger("click");
  expect(wrapper.emitted("close")).toBeTruthy();
});
```

```js
import { mount } from "@vue/test-utils";
import AppDrawer from "./AppDrawer.vue";

test("renders slot content only when open", () => {
  const wrapper = mount(AppDrawer, { props: { open: true, title: "Drawer" }, slots: { default: "<div>Body</div>" } });
  expect(wrapper.text()).toContain("Body");
});
```

```js
test("emits close when drawer backdrop is clicked and stays empty when closed", async () => {
  const wrapper = mount(AppDrawer, { props: { open: false, title: "Drawer" }, slots: { default: "<div>Body</div>" } });
  expect(wrapper.text()).not.toContain("Body");
  await wrapper.setProps({ open: true });
  await wrapper.find(".modal-backdrop").trigger("click");
  expect(wrapper.emitted("close")).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npm run test:run -- src/components/shared/AppModal.test.js src/components/shared/AppDrawer.test.js`
Expected: FAIL because the components do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```vue
<script setup>
defineProps({ open: Boolean, title: { type: String, default: "" } });
defineEmits(["close"]);
</script>
```

And render the current `.modal`, `.modal-backdrop`, `.modal-content`, `.drawer`, `.drawer-content` class structure so existing CSS keeps working.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend; npm run test:run -- src/components/shared/AppModal.test.js src/components/shared/AppDrawer.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/AppModal.vue frontend/src/components/shared/AppDrawer.vue frontend/src/components/shared/AppModal.test.js frontend/src/components/shared/AppDrawer.test.js
git commit -m "feat: add shared modal and drawer components"
```

### Task 2: Add shared table and tab state composables

**Files:**
- Create: `frontend/src/composables/useTableControls.js`
- Create: `frontend/src/composables/useTableControls.test.js`
- Create: `frontend/src/composables/useTabState.js`
- Create: `frontend/src/composables/useTabState.test.js`
- Create: `frontend/src/components/shared/AppPagination.vue`
- Create: `frontend/src/components/shared/AppPagination.test.js`

- [ ] **Step 1: Write the failing tests**

```js
import { useTableControls } from "./useTableControls";

test("filters then sorts rows deterministically", () => {
  const { rows, query, sortKey, sortDirection, visibleRows } = useTableControls({
    rows: [{ code: "B" }, { code: "A" }],
    searchFields: ["code"],
  });
  query.value = "A";
  sortKey.value = "code";
  sortDirection.value = "asc";
  expect(visibleRows.value.map((row) => row.code)).toEqual(["A"]);
});
```

```js
test("recomputes page count and resets current page when query changes", () => {
  const { query, currentPage, pageCount } = useTableControls({
    rows: Array.from({ length: 25 }, (_, index) => ({ code: `T-${index + 1}` })),
    searchFields: ["code"],
    pageSize: 10,
  });
  currentPage.value = 3;
  query.value = "T-1";
  expect(currentPage.value).toBe(1);
  expect(pageCount.value).toBeGreaterThanOrEqual(1);
});
```

```js
import { useTabState } from "./useTabState";

test("switches active tab by key", () => {
  const { activeTab, setActiveTab } = useTabState("unpacking");
  setActiveTab("retention");
  expect(activeTab.value).toBe("retention");
});
```

```js
import { mount } from "@vue/test-utils";
import AppPagination from "@/components/shared/AppPagination.vue";

test("emits page change when pagination button is clicked", async () => {
  const wrapper = mount(AppPagination, { props: { currentPage: 1, pageCount: 3 } });
  await wrapper.find('[data-page="2"]').trigger("click");
  expect(wrapper.emitted("change")).toBeTruthy();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npm run test:run -- src/composables/useTableControls.test.js src/composables/useTabState.test.js src/components/shared/AppPagination.test.js`
Expected: FAIL because the composables do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export function useTableControls(options) {
  // expose query, sortKey, sortDirection, currentPage, visibleRows
}

export function useTabState(initialTab) {
  // expose activeTab and setActiveTab
}
```

Also create `AppPagination.vue` to render page buttons from `currentPage` and `pageCount`.

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/composables/useTableControls.test.js src/composables/useTabState.test.js src/components/shared/AppPagination.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useTableControls.js frontend/src/composables/useTableControls.test.js frontend/src/composables/useTabState.js frontend/src/composables/useTabState.test.js frontend/src/components/shared/AppPagination.vue frontend/src/components/shared/AppPagination.test.js
git commit -m "feat: add shared table and tab state composables"
```

### Task 3: Add shared dialog state composable

**Files:**
- Create: `frontend/src/composables/useDialogState.js`
- Create: `frontend/src/composables/useDialogState.test.js`

- [ ] **Step 1: Write the failing test**

```js
import { useDialogState } from "./useDialogState";

test("opens editor with payload and resets on close", () => {
  const { open, payload, openWith, close } = useDialogState();
  openWith({ id: "1" });
  expect(open.value).toBe(true);
  expect(payload.value.id).toBe("1");
  close();
  expect(open.value).toBe(false);
  expect(payload.value).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/composables/useDialogState.test.js`
Expected: FAIL because the composable does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export function useDialogState() {
  // expose open, payload, openWith, close
}
```

- [ ] **Step 4: Run test**

Run: `cd frontend; npm run test:run -- src/composables/useDialogState.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useDialogState.js frontend/src/composables/useDialogState.test.js
git commit -m "feat: add shared dialog state composable"
```

---

## Chunk 2: Migrate Low-Risk Pages First

### Task 4: Rewrite `SystemPage` as native Vue state

**Files:**
- Create: `frontend/src/lib/systemPageModel.js`
- Create: `frontend/src/composables/useSystemPage.js`
- Modify: `frontend/src/pages/SystemPage.vue`
- Create: `frontend/src/pages/SystemPage.runtime.test.js`

- [ ] **Step 1: Write the failing runtime test**

```js
import { mount } from "@vue/test-utils";
import SystemPage from "./SystemPage.vue";

test("opens role modal from Vue state instead of DOM delegation", async () => {
  const wrapper = mount(SystemPage);
  expect(wrapper.find(".modal.is-open").exists()).toBe(false);
  await wrapper.find('[data-testid="open-role-modal"]').trigger("click");
  expect(wrapper.find(".modal.is-open").exists()).toBe(true);
});
```

```js
test("opens role drawer from Vue state instead of DOM delegation", async () => {
  const wrapper = mount(SystemPage);
  expect(wrapper.find(".drawer.is-open").exists()).toBe(false);
  await wrapper.find('[data-testid="open-role-drawer-0"]').trigger("click");
  expect(wrapper.find(".drawer.is-open").exists()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/pages/SystemPage.runtime.test.js`
Expected: FAIL because the page still relies on legacy delegated events.

- [ ] **Step 3: Write minimal implementation**

```js
export function useSystemPage() {
  // return role rows, createRoleModal state, editRoleDrawer state
}
```

Update `SystemPage.vue` to:
- keep existing card/table/form markup and class names
- replace hardcoded modal/drawer markup with `AppModal` and `AppDrawer`
- use Vue `@click` handlers instead of `data-modal-open` / `data-drawer-open`

- [ ] **Step 4: Run targeted tests**

Run: `cd frontend; npm run test:run -- src/pages/SystemPage.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/systemPageModel.js frontend/src/composables/useSystemPage.js frontend/src/pages/SystemPage.vue frontend/src/pages/SystemPage.runtime.test.js
git commit -m "refactor: migrate system page to native vue state"
```

### Task 5: Rewrite `DashboardPage` as native Vue rendering

**Files:**
- Create: `frontend/src/lib/dashboardPageModel.js`
- Create: `frontend/src/composables/useDashboardPage.js`
- Modify: `frontend/src/pages/DashboardPage.vue`
- Create: `frontend/src/pages/DashboardPage.runtime.test.js`

- [ ] **Step 1: Write the failing runtime test**

```js
import { mount } from "@vue/test-utils";
import { vi } from "vitest";
import DashboardPage from "./DashboardPage.vue";
import { useDashboardPage } from "@/composables/useDashboardPage";

vi.mock("@/composables/useDashboardPage", () => ({
  useDashboardPage: vi.fn(),
}));

test("renders dashboard rows and KPI summaries from Vue state", async () => {
  useDashboardPage.mockReturnValue({
    intakeCount: 1,
    intakeNote: "外部 1 / 内部 0",
    scheduledCount: 2,
    unscheduledCount: 3,
    runningCount: 1,
    alertCount: 0,
    alertNote: "无预警",
    taskRows: [{ code: "T-001", source: "外部委托", status: "待排程" }],
    deviceRows: [{ name: "实验室A", status: "空闲" }],
    dataHealth: "98%",
    dataGap: "暂无缺口",
  });
  const wrapper = mount(DashboardPage);
  expect(wrapper.text()).toContain("T-001");
  expect(wrapper.text()).toContain("98%");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/pages/DashboardPage.runtime.test.js`
Expected: FAIL because rows are still filled by legacy render code.

- [ ] **Step 3: Write minimal implementation**

```js
export function buildDashboardViewModel({ tasks, schedules, streams, devices }) {
  // compute KPI values and visible task rows
}
```

Create `useDashboardPage()` that wraps `useStorageSnapshot`, calls `buildDashboardViewModel()`, and renders KPI/table/timeline with `v-for`.

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/pages/DashboardPage.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/dashboardPageModel.js frontend/src/composables/useDashboardPage.js frontend/src/pages/DashboardPage.vue frontend/src/pages/DashboardPage.runtime.test.js
git commit -m "refactor: migrate dashboard page to native vue rendering"
```

### Task 6: Remove `system` and `dashboard` from the legacy route list

**Files:**
- Modify: `frontend/src/lib/appConfig.js`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Write the failing regression test**

```js
test("does not boot legacy ui for migrated dashboard and system routes", async () => {
  for (const routeName of ["dashboard", "system"]) {
    reactiveRoute.name = routeName;
    reactiveRoute.meta = { module: "central", legacyUi: false };
    await Promise.resolve();
    expect(bootLegacyUI).not.toHaveBeenCalled();
  }
});
```

```js
test("stays bridge-free after navigating from a vue-native route to dashboard", async () => {
  reactiveRoute.name = "process";
  reactiveRoute.meta = { module: "central" };
  reactiveRoute.name = "dashboard";
  reactiveRoute.meta = { module: "central", legacyUi: false };
  await Promise.resolve();
  expect(bootLegacyUI).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/App.runtime.test.js`
Expected: FAIL because the routes are still marked as legacy.

- [ ] **Step 3: Write minimal implementation**

Remove `dashboard` and `system` from `LEGACY_UI_ROUTE_NAMES` and delete their `meta.legacyUi` route flags.

- [ ] **Step 4: Run test**

Run: `cd frontend; npm run test:run -- src/App.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/appConfig.js frontend/src/router/index.js frontend/src/App.runtime.test.js
git commit -m "refactor: stop booting legacy ui for dashboard and system"
```

---

## Chunk 3: Migrate Medium-Risk Data and Device Pages

### Task 7: Rewrite `DataPage` with Vue-managed table, report modal, and detail drawer

**Files:**
- Create: `frontend/src/lib/dataPageModel.js`
- Create: `frontend/src/composables/useDataPage.js`
- Modify: `frontend/src/pages/DataPage.vue`
- Create: `frontend/src/pages/DataPage.runtime.test.js`

- [ ] **Step 1: Write the failing runtime test**

```js
import { mount } from "@vue/test-utils";
import DataPage from "./DataPage.vue";

test("opens report modal and validates from Vue actions", async () => {
  const wrapper = mount(DataPage);
  await wrapper.find('[data-testid="data-generate-report"]').trigger("click");
  expect(wrapper.text()).toContain("报告预览");
});
```

```js
test("opens data detail drawer from a Vue-rendered row action", async () => {
  const wrapper = mount(DataPage);
  await wrapper.find('[data-testid="open-data-drawer-0"]').trigger("click");
  expect(wrapper.find(".drawer.is-open").exists()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/pages/DataPage.runtime.test.js`
Expected: FAIL because the page still uses `data-action` and delegated DOM events.

- [ ] **Step 3: Write minimal implementation**

```js
export function useDataPage() {
  // expose table rows, selected row, validateReport, openReportModal, openDataDrawer
}
```

Back the table with `useTableControls`, keep `.table`, `.toolbar`, `.form-grid`, `.form-actions` class names unchanged, and replace both report modal and detail drawer with Vue-managed state.

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/pages/DataPage.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/dataPageModel.js frontend/src/composables/useDataPage.js frontend/src/pages/DataPage.vue frontend/src/pages/DataPage.runtime.test.js
git commit -m "refactor: migrate data page to native vue state"
```

### Task 8: Rewrite `DevicesPage` with Vue-managed form and maintenance drawer

**Files:**
- Create: `frontend/src/lib/devicesPageModel.js`
- Create: `frontend/src/lib/devicePointsModel.js`
- Create: `frontend/src/composables/useDevicesPage.js`
- Create: `frontend/src/composables/useDevicePoints.js`
- Modify: `frontend/src/pages/DevicesPage.vue`
- Create: `frontend/src/pages/DevicesPage.runtime.test.js`

- [ ] **Step 1: Write the failing runtime test**

```js
import { mount } from "@vue/test-utils";
import DevicesPage from "./DevicesPage.vue";

test("adds a device row through Vue form state", async () => {
  const wrapper = mount(DevicesPage);
  await wrapper.find('input[name="code"]').setValue("HPLC-99");
  await wrapper.find('[data-testid="device-save"]').trigger("click");
  expect(wrapper.text()).toContain("HPLC-99");
});
```

```js
test("opens maintenance drawer and point modal from Vue state", async () => {
  const wrapper = mount(DevicesPage);
  await wrapper.find('[data-testid="open-device-drawer"]').trigger("click");
  expect(wrapper.find(".drawer.is-open").exists()).toBe(true);
  await wrapper.find('[data-testid="open-point-modal"]').trigger("click");
  expect(wrapper.find(".modal.is-open").exists()).toBe(true);
});
```

```js
test("updates reactive test-type and lab options without legacy DOM patching", async () => {
  const wrapper = mount(DevicesPage);
  expect(wrapper.findAll('select[name="type"] option').length).toBeGreaterThan(1);
  expect(wrapper.findAll('select[name="location"] option').length).toBeGreaterThan(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/pages/DevicesPage.runtime.test.js`
Expected: FAIL because the device form is still wired through legacy actions.

- [ ] **Step 3: Write minimal implementation**

```js
export function useDevicesPage() {
  // expose device form, saveDevice, addBlankDevice, selectedMaintenanceDevice
}

export function useDevicePoints() {
  // expose point rows, point form modal state, and point create/update actions
}
```

Split the page into:
- device form/list/maintenance behavior in `devicesPageModel.js` + `useDevicesPage.js`
- point-mapping modal/table behavior in `devicePointsModel.js` + `useDevicePoints.js`

Reuse `useStorageSnapshot`, `useDialogState`, `useTableControls`; keep `data-lab-select` and `data-test-type-select` behavior via reactive options instead of DOM patching.

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/pages/DevicesPage.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/devicesPageModel.js frontend/src/composables/useDevicesPage.js frontend/src/pages/DevicesPage.vue frontend/src/pages/DevicesPage.runtime.test.js
git commit -m "refactor: migrate devices page to native vue state"
```

### Task 9: Remove `data` and `devices` from the legacy route list

**Files:**
- Modify: `frontend/src/lib/appConfig.js`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/App.runtime.test.js`

- [ ] **Step 1: Write the failing regression test**

```js
test("does not boot legacy ui for migrated data and devices routes", async () => {
  for (const routeName of ["data", "devices"]) {
    reactiveRoute.name = routeName;
    reactiveRoute.meta = { module: "central", legacyUi: false };
    await Promise.resolve();
    expect(bootLegacyUI).not.toHaveBeenCalled();
  }
});
```

```js
test("keeps mocked legacy route name set aligned with remaining bridge pages", () => {
  expect(legacyRouteNames.has("data")).toBe(false);
  expect(legacyRouteNames.has("devices")).toBe(false);
});
```

- [ ] **Step 2: Run `cd frontend; npm run test:run -- src/App.runtime.test.js` and confirm it fails**
- [ ] **Step 3: Remove `data` and `devices` from `LEGACY_UI_ROUTE_NAMES`, route `meta.legacyUi`, and the mocked `legacyRouteNames` set in `frontend/src/App.runtime.test.js`**
- [ ] **Step 4: Re-run the test and confirm it passes**
- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/appConfig.js frontend/src/router/index.js frontend/src/App.runtime.test.js
git commit -m "refactor: stop booting legacy ui for data and devices"
```

---

## Chunk 4: Migrate High-Risk Workflow Pages and Remove the Bridge

### Task 10: Extract task-domain model logic before touching `TasksPage.vue`

**Files:**
- Create: `frontend/src/lib/tasksPageModel.js`
- Create: `frontend/src/lib/tasksPageModel.test.js`

- [ ] **Step 1: Write the failing unit tests**

```js
import {
  buildTaskRows,
  createTaskDraft,
  updateTaskRecord,
  deleteTaskRecord,
  buildTaskCode,
} from "./tasksPageModel";

test("buildTaskCode preserves current prefix and sequence rules", () => {
  const code = buildTaskCode({
    source: "外部委托",
    testType: "冲击试验",
    year: "2026",
    existingTasks: [{ code: "CJ-2026-001" }],
  });
  expect(code).toBe("CJ-2026-002");
});
```

```js
test("updateTaskRecord preserves status labels and field normalization", () => {
  const next = updateTaskRecord({
    currentTask: { code: "CJ-2026-001", status: "待排程" },
    patch: { name: "来料检测-批次A" },
  });
  expect(next.status).toBe("待排程");
  expect(next.name).toBe("来料检测-批次A");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npm run test:run -- src/lib/tasksPageModel.test.js`
Expected: FAIL because the model file does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export function buildTaskCode(input) {}
export function createTaskDraft(input) {}
export function updateTaskRecord(input) {}
export function deleteTaskRecord(input) {}
export function buildTaskRows(input) {}
```

Keep task code generation, status labels, and row shaping pure and independent from Vue.

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/lib/tasksPageModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/tasksPageModel.js frontend/src/lib/tasksPageModel.test.js
git commit -m "test: lock task page model behavior before vue migration"
```

### Task 11: Migrate `TasksPage` list/filter/pagination separately from dialogs

**Files:**
- Create: `frontend/src/composables/useTasksPage.js`
- Modify: `frontend/src/pages/TasksPage.vue`
- Create: `frontend/src/pages/TasksPage.runtime.test.js`

- [ ] **Step 1: Write the failing runtime test for list behavior**

```js
import { mount } from "@vue/test-utils";
import TasksPage from "./TasksPage.vue";

test("filters, sorts, and paginates task rows from Vue state", async () => {
  const wrapper = mount(TasksPage);
  await wrapper.find('#task-list-search').setValue("CJ-2026");
  expect(wrapper.findAll("#task-table-body tr").length).toBeGreaterThanOrEqual(0);
});
```

```js
test("opens intake modal and edit drawer from Vue state", async () => {
  const wrapper = mount(TasksPage);
  await wrapper.find('[data-testid="open-task-intake"]').trigger("click");
  expect(wrapper.text()).toContain("手动添加任务");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/pages/TasksPage.runtime.test.js`
Expected: FAIL because list rendering and dialog state still rely on legacy runtime.

- [ ] **Step 3: Write minimal implementation**

```js
export function useTasksPage() {
  // expose table controls, intake dialog state, edit drawer state, and CRUD actions
}
```

Implement in two passes:
- first pass: render rows, filter, sort, and paginate with `useTableControls`
- second pass: connect intake modal and edit drawer with `useDialogState`

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/pages/TasksPage.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useTasksPage.js frontend/src/pages/TasksPage.vue frontend/src/pages/TasksPage.runtime.test.js
git commit -m "refactor: migrate task list and dialogs to native vue state"
```

### Task 12: Extract schedule-domain model logic before touching `SchedulePage.vue`

**Files:**
- Create: `frontend/src/lib/schedulePageModel.js`
- Create: `frontend/src/lib/schedulePageModel.test.js`

- [ ] **Step 1: Write the failing unit tests**

```js
import {
  buildGanttRows,
  buildConflictRows,
  createScheduleDraft,
  updateScheduleRecord,
} from "./schedulePageModel";

test("buildConflictRows preserves overlapping schedule conflicts", () => {
  const rows = buildConflictRows({
    schedules: [
      { id: "1", device: "实验室A", start_at: "2026-03-12T08:00:00", end_at: "2026-03-12T10:00:00" },
      { id: "2", device: "实验室A", start_at: "2026-03-12T09:00:00", end_at: "2026-03-12T11:00:00" },
    ],
  });
  expect(rows).toHaveLength(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npm run test:run -- src/lib/schedulePageModel.test.js`
Expected: FAIL because the model file does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export function buildGanttRows(input) {}
export function buildConflictRows(input) {}
export function createScheduleDraft(input) {}
export function updateScheduleRecord(input) {}
```

Keep gantt shaping, conflict detection, and form normalization pure and testable.

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/lib/schedulePageModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/schedulePageModel.js frontend/src/lib/schedulePageModel.test.js
git commit -m "test: lock schedule page model behavior before vue migration"
```

### Task 13: Migrate `SchedulePage` in two bounded slices

**Files:**
- Create: `frontend/src/composables/useSchedulePage.js`
- Modify: `frontend/src/pages/SchedulePage.vue`
- Create: `frontend/src/pages/SchedulePage.runtime.test.js`

- [ ] **Step 1: Write the failing runtime test for tab and board rendering**

```js
import { mount } from "@vue/test-utils";
import SchedulePage from "./SchedulePage.vue";

test("switches tabs and renders gantt rows from Vue state", async () => {
  const wrapper = mount(SchedulePage);
  await wrapper.find('[data-testid="schedule-tab-retention"]').trigger("click");
  expect(wrapper.text()).toContain("暂存间内部排程单");
});
```

```js
test("opens schedule drawer and preserves conflict rows", async () => {
  const wrapper = mount(SchedulePage);
  expect(wrapper.find("#conflict-table").exists()).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/pages/SchedulePage.runtime.test.js`
Expected: FAIL because tab switching, gantt rendering, and drawer state still rely on legacy events.

- [ ] **Step 3: Write minimal implementation**

```js
export function useSchedulePage() {
  // expose activeTab, manualScheduleForm, ganttRows, scheduleRows, conflictRows, editor state
}
```

Implement in two passes:
- first pass: tab state + gantt + schedule/conflict tables
- second pass: edit drawer + create/update/delete schedule actions

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/pages/SchedulePage.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useSchedulePage.js frontend/src/pages/SchedulePage.vue frontend/src/pages/SchedulePage.runtime.test.js
git commit -m "refactor: migrate schedule board and editor to native vue state"
```

### Task 14: Split `SamplesPage` model into focused pure helpers first

**Files:**
- Create: `frontend/src/lib/samplesPageModel.js`
- Create: `frontend/src/lib/samplesPageModel.test.js`

- [ ] **Step 1: Write the failing unit tests**

```js
import {
  buildSampleRows,
  buildStagingRows,
  buildTraceTimeline,
  buildTrayPlannerState,
} from "./samplesPageModel";

test("buildTrayPlannerState preserves tray capacity and sample assignment", () => {
  const state = buildTrayPlannerState({
    taskCode: "CJ-2026-001",
    samples: [{ code: "S-001" }, { code: "S-002" }],
    trayLimit: 1,
  });
  expect(state.trays).toHaveLength(2);
});
```

```js
test("buildTraceTimeline preserves sample event order", () => {
  const rows = buildTraceTimeline({
    events: [
      { at: "2026-03-12T10:00:00", label: "暂存" },
      { at: "2026-03-12T08:00:00", label: "登记" },
    ],
  });
  expect(rows[0].label).toBe("登记");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend; npm run test:run -- src/lib/samplesPageModel.test.js`
Expected: FAIL because the model file does not exist yet.

- [ ] **Step 3: Write minimal implementation**

```js
export function buildSampleRows(input) {}
export function buildStagingRows(input) {}
export function buildTraceTimeline(input) {}
export function buildTrayPlannerState(input) {}
```

Keep intake/staging/trace/tray logic independent from DOM and independent from Vue instance state.

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/lib/samplesPageModel.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/samplesPageModel.js frontend/src/lib/samplesPageModel.test.js
git commit -m "test: lock samples page model behavior before vue migration"
```

### Task 15: Migrate `SamplesPage` in three bounded slices

**Files:**
- Create: `frontend/src/composables/useSamplesPage.js`
- Modify: `frontend/src/pages/SamplesPage.vue`
- Create: `frontend/src/pages/SamplesPage.runtime.test.js`

- [ ] **Step 1: Write the failing runtime tests**

```js
import { mount } from "@vue/test-utils";
import SamplesPage from "./SamplesPage.vue";

test("opens intake and batch modal from Vue state", async () => {
  const wrapper = mount(SamplesPage);
  await wrapper.find('[data-testid="open-sample-modal"]').trigger("click");
  expect(wrapper.text()).toContain("批量入库");
});
```

```js
test("renders staging rows and trace output from Vue state", async () => {
  const wrapper = mount(SamplesPage);
  expect(wrapper.find("#staging-table").exists()).toBe(true);
});
```

```js
test("renders tray planner state without legacy drag bootstrap", async () => {
  const wrapper = mount(SamplesPage);
  expect(wrapper.text()).toContain("确认入库");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/pages/SamplesPage.runtime.test.js`
Expected: FAIL because samples intake, staging dispatch, trace, and tray planner still rely on legacy runtime.

- [ ] **Step 3: Write minimal implementation**

```js
export function useSamplesPage() {
  // expose intake forms, batch form, staging queue, trace state, tray planner state, modal and drawer state
}
```

Implement in three passes:
- first pass: intake + batch modal
- second pass: staging dispatch + trace query
- third pass: tray planner + print action wiring

- [ ] **Step 4: Run tests**

Run: `cd frontend; npm run test:run -- src/pages/SamplesPage.runtime.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/composables/useSamplesPage.js frontend/src/pages/SamplesPage.vue frontend/src/pages/SamplesPage.runtime.test.js
git commit -m "refactor: migrate samples workflows to native vue state"
```

### Task 16: Remove the legacy bridge and exact dead runtime files

**Files:**
- Modify: `frontend/src/App.vue`
- Modify: `frontend/src/lib/appConfig.js`
- Modify: `frontend/src/router/index.js`
- Modify: `frontend/src/App.runtime.test.js`
- Delete: `frontend/src/legacy/boot.js`
- Delete: `frontend/src/legacy/runtime/actions.js`
- Delete: `frontend/src/legacy/runtime/labels.js`
- Delete: `frontend/src/legacy/runtime/labs.js`
- Delete: `frontend/src/legacy/runtime/main.js`
- Delete: `frontend/src/legacy/runtime/render.js`
- Delete: `frontend/src/legacy/runtime/seed.js`
- Delete: `frontend/src/legacy/runtime/storage.js`
- Delete: `frontend/src/legacy/runtime/ui.js`
- Delete: `frontend/src/legacy/runtime/utils.js`
- Modify: `README.md`

- [ ] **Step 1: Write the failing regression tests**

```js
test("never boots legacy ui for tasks, schedule, or samples after migration", async () => {
  for (const routeName of ["tasks", "schedule", "samples"]) {
    reactiveRoute.name = routeName;
    reactiveRoute.meta = { module: "central" };
    expect(bootLegacyUI).not.toHaveBeenCalled();
  }
});
```

```js
test("legacy route metadata list is empty after final migration", () => {
  expect(appConfig.legacyUiRoutes).toEqual([]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend; npm run test:run -- src/App.runtime.test.js`
Expected: FAIL because `App.vue` still imports legacy boot and routes still contain `legacyUi` markers.

- [ ] **Step 3: Write minimal implementation**

Remove:

```js
import { shouldBridgeLegacyUi } from "@/lib/appConfig";
import { bootLegacyUI } from "./legacy/boot.js";
```

Then:
- delete all remaining `meta.legacyUi` flags from routes
- set `legacyUiRoutes` to `[]`
- remove the `legacyUiBootKey` watcher branch

- [ ] **Step 4: Run targeted tests and build**

Run: `cd frontend; npm run test:run -- src/App.runtime.test.js; npm run build`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.vue frontend/src/lib/appConfig.js frontend/src/router/index.js frontend/src/App.runtime.test.js README.md
git rm frontend/src/legacy/boot.js frontend/src/legacy/runtime/actions.js frontend/src/legacy/runtime/labels.js frontend/src/legacy/runtime/labs.js frontend/src/legacy/runtime/main.js frontend/src/legacy/runtime/render.js frontend/src/legacy/runtime/seed.js frontend/src/legacy/runtime/storage.js frontend/src/legacy/runtime/ui.js frontend/src/legacy/runtime/utils.js
git commit -m "refactor: remove legacy ui bridge after full vue migration"
```

### Task 17: Run full verification and manual parity checks

**Files:**
- Verify only

- [ ] **Step 1: Run frontend unit and runtime tests**

Run: `cd frontend; npm run test:run`
Expected: PASS

- [ ] **Step 2: Run frontend build**

Run: `cd frontend; npm run build`
Expected: PASS

- [ ] **Step 3: Run backend smoke tests without blocking frontend completion**

Run: `python -m pytest -v`
Expected: PASS or only unrelated existing failures outside the frontend migration scope; unrelated backend failures should be recorded, not fixed in this plan.

- [ ] **Step 4: Run manual page parity walkthrough**

Verify the following routes manually:
- `/`
- `/tasks`
- `/schedule`
- `/samples`
- `/devices`
- `/data`
- `/system`

Expected:
- 页面标题和导航不变
- 按钮文案不变
- modal / drawer 打开关闭路径不变
- 表格筛选、排序、分页行为与迁移前一致
- 任务编码、排程冲突、样品轨迹、托盘容量行为与迁移前一致

- [ ] **Step 5: Capture migration completion in docs**

Update `README.md` to state that the frontend no longer depends on `frontend/src/legacy/` runtime files.

---

## Recommended Execution Order

1. Chunk 1 first, because modal/drawer/table/tab primitives are被 7 个页面复用，先做能避免后续重复实现。
2. Chunk 2 second, because `system` 与 `dashboard` 风险最低，最适合验证共享模式是否足够稳定。
3. Chunk 3 third, because `data` 与 `devices` 可以复用同一套表单、表格、抽屉模式。
4. Chunk 4 last, because `tasks`、`schedule`、`samples` 持有最多 legacy 业务逻辑，必须在共享模式稳定后再处理。

## Manual Parity Checklist

- 样式：卡片、按钮、抽屉、模态框、表格、分页、Tab 的 class 名称和层级保持兼容现有 `mes-app.css`
- 路由：URL、导航高亮、页面标题、模块切换方式不变
- 交互：点击入口、关闭方式、筛选条件、排序字段、分页数量、表单必填项不变
- 数据：任务、样品、设备、排程、数据流的读取来源继续通过现有 `useStorageSnapshot` / storage API
- 回滚：每完成一个页面迁移就从 `LEGACY_UI_ROUTE_NAMES` 中删除一个页面，若发现重大差异可只回滚该页面对应 commit

## Notes for the Implementer

- 不要先大规模重写 `SamplesPage`；它必须最后迁移。
- 不要在迁移过程中顺手改视觉设计；这是行为保持型重构，不是 UI 重设计。
- 不要一次性删除整个 legacy runtime；只有在所有页面都脱离 bridge 后才能删。
- 尽量把复杂逻辑放进 `lib/*Model.js` 和 `composables/use*.js`，让 `.vue` 页面保持可读。
- 若某个页面在迁移时发现现有 DOM 行为本身不一致，先写回归测试固定“当前行为”，再决定是否修正。
