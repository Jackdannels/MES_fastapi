import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { TEST_LABS } from "@/lib/labs";
import { RETENTION_DEVICE, STATUS_RETENTION, STATUS_SCHEDULED, STATUS_WAITING } from "./model";
import SchedulePage from "./page.vue";

const TASKS_KEY = "mes.tasks";
const DEVICES_KEY = "mes.devices";
const SAMPLES_KEY = "mes.samples";
const SCHEDULES_KEY = "mes.schedules";
const STREAMS_KEY = "mes.streams";
const EXPERIMENTS_KEY = "mes.experiments";
const EXPERIMENT_RUNS_KEY = "mes.experiment_runs";
const EXPERIMENT_RUN_STEPS_KEY = "mes.experiment_run_steps";
const EXPERIMENT_RUN_TRAYS_KEY = "mes.experiment_run_trays";
const EXPERIMENT_TRAYS_KEY = "mes.experiment_trays";
const CONFLICTS_KEY = "mes.conflicts";

const PRIMARY_LAB = TEST_LABS[0];
const SECONDARY_LAB = TEST_LABS[1];
const TERTIARY_LAB = TEST_LABS[2];

let storageState = {};
let fetchMock = null;
let pageHeader = null;
let headerActions = null;
let masterLabsState = [];
let masterLabsShouldFail = false;

const buildDateParts = (offsetDays = 0) => {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return {
    isoDate: `${year}-${month}-${day}`,
    isoMorningEnd: `${year}-${month}-${day}T10:00:00.000Z`,
    isoMorningStart: `${year}-${month}-${day}T08:00:00.000Z`,
  };
};

const setStorage = (key, value) => {
  storageState[key] = JSON.parse(JSON.stringify(value));
};

const getStorage = (key) => JSON.parse(JSON.stringify(storageState[key] ?? []));

const resetStorage = () => {
  storageState = {};
  masterLabsState = [];
  masterLabsShouldFail = false;
};

const patchRowKey = (key, row) => {
  if (!row || typeof row !== "object") {
    return "";
  }
  if (key === TASKS_KEY) {
    return String(row.code || row.id || "").trim();
  }
  if (key === EXPERIMENTS_KEY) {
    return `${String(row.task_code || row.taskCode || "").trim()}::${String(row.experiment_code || row.experimentCode || "").trim()}`;
  }
  if (key === SCHEDULES_KEY) {
    return String(row.id || "").trim() || [
      String(row.task_code || row.taskCode || "").trim(),
      String(row.experiment_code || row.experimentCode || "").trim(),
      String(row.device || "").trim(),
    ].join("::");
  }
  return String(row.id || "").trim();
};

const applyStoragePatchRows = (key, upserts = [], deletes = []) => {
  const currentRows = getStorage(key);
  const upsertByKey = new Map(
    (Array.isArray(upserts) ? upserts : [])
      .map((row) => [patchRowKey(key, row), row])
      .filter(([rowKey]) => rowKey),
  );
  const deleteKeys = new Set((Array.isArray(deletes) ? deletes : []).map((value) => String(value || "").trim()).filter(Boolean));
  const orderedKeys = [];
  [...currentRows, ...(Array.isArray(upserts) ? upserts : [])].forEach((row) => {
    const rowKey = patchRowKey(key, row);
    if (rowKey && !orderedKeys.includes(rowKey)) {
      orderedKeys.push(rowKey);
    }
  });
  const currentByKey = new Map(currentRows.map((row) => [patchRowKey(key, row), row]).filter(([rowKey]) => rowKey));
  storageState[key] = orderedKeys
    .filter((rowKey) => !deleteKeys.has(rowKey))
    .map((rowKey) => upsertByKey.get(rowKey) || currentByKey.get(rowKey))
    .filter(Boolean)
    .map((row) => JSON.parse(JSON.stringify(row)));
};

const installStorageFetchMock = () => {
  fetchMock = vi.fn(async (input, options = {}) => {
    const url = String(input);
    const method = options.method ?? "GET";
    const pathname = new URL(url, "http://localhost").pathname;

    if (pathname === "/api/storage" && method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(JSON.stringify(storageState)),
      };
    }

    if (pathname === "/api/storage" && method === "PUT") {
      const updates = JSON.parse(options.body ?? "{}");
      Object.entries(updates).forEach(([key, value]) => {
        if (Array.isArray(value)) {
          storageState[key] = JSON.parse(JSON.stringify(value));
        }
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      };
    }

    if (url.endsWith("/api/storage/schedules/patch") && method === "POST") {
      const patch = JSON.parse(options.body ?? "{}");
      const keys = new Set([
        ...Object.keys(patch.upserts || {}),
        ...Object.keys(patch.deletes || {}),
      ]);
      keys.forEach((key) => {
        applyStoragePatchRows(key, patch.upserts?.[key], patch.deletes?.[key]);
      });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, updatedKeys: [...keys] }),
      };
    }

    if (url.endsWith("/api/master/labs") && method === "GET") {
      if (masterLabsShouldFail) {
        return {
          ok: false,
          status: 500,
          statusText: "Server Error",
          json: async () => ({ message: "Server Error" }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(JSON.stringify(masterLabsState)),
      };
    }

    throw new Error(`Unhandled fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
};

const settle = async (wrapper) => {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
    await wrapper.vm.$nextTick();
  }
};

const installHeaderActions = () => {
  pageHeader = document.createElement("header");
  pageHeader.className = "page-header";
  pageHeader.innerHTML = `
    <div>
      <div class="eyebrow">中控中心</div>
      <h1>排程看板</h1>
      <p class="subtitle">统一排程与冲突管理。</p>
    </div>
    <div class="header-actions">
      <button class="action-btn secondary" type="button">刷新</button>
      <button class="action-btn secondary" data-testid="app-logout" type="button">退出登录</button>
    </div>
  `;
  document.body.appendChild(pageHeader);
  headerActions = pageHeader.querySelector(".header-actions");
};

describe("SchedulePage runtime", () => {
  beforeEach(() => {
    resetStorage();
    installStorageFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorage();
    pageHeader?.remove();
    pageHeader = null;
    headerActions = null;
  });

  test("renders one unified scheduling page without unpacking or retention tabs", async () => {
    const today = buildDateParts(0);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Task A", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
      { id: "task-2", code: "SYLU-2026-01-002", name: "Task B", test_type: "UNKNOWN", status: STATUS_RETENTION },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-retention-1",
        task_code: "SYLU-2026-01-002",
        device: RETENTION_DEVICE,
        start_at: today.isoMorningStart,
        end_at: today.isoMorningEnd,
        status: STATUS_RETENTION,
      },
    ]);
    setStorage(SAMPLES_KEY, [
      {
        id: "sample-1",
        code: "SYLU-2026-01-002-SP-001",
        task_code: "SYLU-2026-01-002",
        location: RETENTION_DEVICE,
        retention_source: "intake",
        created_at: today.isoMorningStart,
      },
    ]);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    expect(wrapper.findAll("#gantt-body tr").length).toBeGreaterThan(0);
    expect(wrapper.get('select[name="task_code"]').text()).toContain("SYLU-2026-01-001");
    expect(wrapper.find('[data-testid="schedule-tab-unpacking"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="schedule-tab-retention"]').exists()).toBe(false);
    expect(wrapper.find("#retention-internal-table").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("冲突提醒");
    expect(wrapper.text()).not.toContain("变更申请");
    expect(wrapper.text()).not.toContain("待解决冲突");
    expect(wrapper.find("#conflict-table").exists()).toBe(false);
  });

  test("labels the manual schedule reset action as reset", async () => {
    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const actions = wrapper.get(".form-actions");
    expect(actions.text()).toContain("重置");
    expect(actions.text()).not.toContain("清空");
  });

  test("shows at most ten schedule rows per page and keeps sequence numbers across pages", async () => {
    setStorage(TASKS_KEY, [
      { id: "task-pagination", code: "TASK-PAGINATION", name: "分页任务", test_type: "冲击试验", status: STATUS_WAITING },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(EXPERIMENTS_KEY, [
      { task_code: "TASK-PAGINATION", experiment_code: "TASK-PAGINATION-A", experiment_name: "冲击试验" },
    ]);
    setStorage(SCHEDULES_KEY, Array.from({ length: 11 }, (_, index) => {
      const startAt = new Date(Date.UTC(2099, 2, 20, index, 0, 0));
      return {
        id: `schedule-pagination-${index + 1}`,
        task_code: "TASK-PAGINATION",
        experiment_code: "TASK-PAGINATION-A",
        device: PRIMARY_LAB,
        start_at: startAt.toISOString(),
        end_at: new Date(startAt.getTime() + 30 * 60 * 1000).toISOString(),
        status: STATUS_SCHEDULED,
      };
    }));

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    expect(wrapper.findAll("#schedule-table tbody tr")).toHaveLength(10);
    expect(wrapper.get('[data-testid="schedule-pagination"]').text()).toContain("第 1 / 2 页");

    await wrapper.get('[data-testid="schedule-pagination"] button[data-page="next"]').trigger("click");
    await settle(wrapper);

    const secondPageRows = wrapper.findAll("#schedule-table tbody tr");
    expect(secondPageRows).toHaveLength(1);
    expect(secondPageRows[0].get("td").text()).toBe("11");
    expect(wrapper.get('[data-testid="schedule-pagination"]').text()).toContain("第 2 / 2 页");
    wrapper.unmount();
  });

  test("shows effective schedule times with automatic-delay audit context", async () => {
    setStorage(TASKS_KEY, [
      { id: "task-delayed", code: "TASK-DELAYED", name: "顺延任务", test_type: "盐雾试验", status: STATUS_WAITING },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(EXPERIMENTS_KEY, [
      { task_code: "TASK-DELAYED", experiment_code: "TASK-DELAYED-A", experiment_name: "盐雾试验" },
    ]);
    setStorage(SCHEDULES_KEY, [{
      id: "schedule-delayed",
      task_code: "TASK-DELAYED",
      experiment_code: "TASK-DELAYED-A",
      device: PRIMARY_LAB,
      start_at: "2099-03-20T03:30:00",
      end_at: "2099-03-20T04:30:00",
      original_start_at: "2099-03-20T02:40:00",
      original_end_at: "2099-03-20T03:40:00",
      delay_minutes: 50,
      delay_reason: "前序实验超时",
      delay_source_run_no: "run-delayed-001",
      status: STATUS_SCHEDULED,
    }]);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const delayMeta = wrapper.get('[data-testid="schedule-delay-schedule-delayed"]');
    expect(delayMeta.text()).toContain("自动顺延 50 分钟");
    expect(delayMeta.text()).toContain("原 2099-03-20 02:40");
    expect(delayMeta.attributes("title")).toContain("原因：前序实验超时");
    expect(delayMeta.attributes("title")).toContain("来源运行：run-delayed-001");
    expect(wrapper.get("#schedule-table").text()).toContain("2099-03-20 04:30");
    expect(wrapper.get("#schedule-table").text()).toContain("原 2099-03-20 03:40");
    wrapper.unmount();
  });

  test("shows a warning and keeps storage unchanged when deleting a running schedule from task detail", async () => {
    const today = buildDateParts(0);
    setStorage(TASKS_KEY, [
      { id: "task-running", code: "TASK-RUNNING", name: "进行中任务", test_type: "冲击试验", status: "任务进行中" },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(EXPERIMENTS_KEY, [
      { task_code: "TASK-RUNNING", experiment_code: "TASK-RUNNING-A", experiment_name: "冲击试验", status: "实验进行中" },
    ]);
    setStorage(EXPERIMENT_TRAYS_KEY, [
      { task_code: "TASK-RUNNING", experiment_code: "TASK-RUNNING-A", tray_code: "TASK-RUNNING-TP-001" },
    ]);
    setStorage(SAMPLES_KEY, [
      {
        code: "TASK-RUNNING-SP-001",
        task_code: "TASK-RUNNING",
        status: "实验进行中",
        trays: [{ tray_code: "TASK-RUNNING-TP-001", status: "实验进行中", quantity: 1 }],
      },
    ]);
    setStorage(EXPERIMENT_RUNS_KEY, [
      { task_code: "TASK-RUNNING", experiment_code: "TASK-RUNNING-A", status: "实验进行中" },
    ]);
    setStorage(EXPERIMENT_RUN_TRAYS_KEY, []);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-running",
        task_code: "TASK-RUNNING",
        experiment_code: "TASK-RUNNING-A",
        device: PRIMARY_LAB,
        start_at: today.isoMorningStart,
        end_at: today.isoMorningEnd,
        status: "已排程",
      },
    ]);

    const wrapper = mount(SchedulePage, { attachTo: document.body });
    await settle(wrapper);

    await wrapper.get('[data-testid="gantt-segment-schedule-running"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-detail-delete"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="task-detail-warning"]').text()).toContain("排程已完成任务比对，不能删除");
    expect(getStorage(SCHEDULES_KEY)).toEqual([
      expect.objectContaining({ id: "schedule-running" }),
    ]);

    wrapper.unmount();
  });

  test("teleports an exception action into the schedule header", async () => {
    installHeaderActions();
    setStorage(CONFLICTS_KEY, [
      {
        id: "conflict-1",
        type: "schedule_missed_start",
        status: "pending",
        task_code: "TASK-001",
        reason: "排程时段内未开始实验，系统已自动撤销排程",
      },
    ]);

    const wrapper = mount(SchedulePage, { attachTo: document.body });
    await settle(wrapper);

    const exceptionButton = document.body.querySelector('[data-testid="schedule-exception-action"]');
    expect(exceptionButton).not.toBeNull();
    expect(String(exceptionButton?.textContent || "").trim()).toBe("异常处理 1");
    expect(exceptionButton?.className || "").toContain("schedule-header-action-button--exception");
    expect(exceptionButton?.className || "").toContain("is-alert");

    const headerButtons = Array.from(headerActions.querySelectorAll("button")).map((button) => String(button.textContent || "").trim());
    expect(headerButtons).toContain("异常处理 1");

    wrapper.unmount();
  });

  test("keeps the exception action blue when there are no pending exceptions", async () => {
    installHeaderActions();
    setStorage(CONFLICTS_KEY, []);

    const wrapper = mount(SchedulePage, { attachTo: document.body });
    await settle(wrapper);

    const exceptionButton = document.body.querySelector('[data-testid="schedule-exception-action"]');
    expect(exceptionButton).not.toBeNull();
    expect(String(exceptionButton?.textContent || "").trim()).toBe("异常处理");
    expect(exceptionButton?.className || "").not.toContain("is-alert");

    wrapper.unmount();
  });

  test("reconciles expired unstarted schedules on load and lets the user acknowledge the generated exception", async () => {
    installHeaderActions();
    setStorage(TASKS_KEY, [
      { code: "TASK-001", name: "任务001", status: "已排程", test_type: "冲击试验" },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "冲击试验", status: "已排程" },
    ]);
    setStorage(EXPERIMENT_TRAYS_KEY, [
      { task_code: "TASK-001", experiment_code: "TASK-001-A", tray_code: "TASK-001-TP-001" },
    ]);
    setStorage(SAMPLES_KEY, [
      {
        code: "TASK-001-SP-001",
        task_code: "TASK-001",
        location: PRIMARY_LAB,
        status: "送至实验室",
        trays: [{ tray_code: "TASK-001-TP-001", status: "送至实验室", quantity: 1 }],
        history: [],
      },
    ]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        device: PRIMARY_LAB,
        start_at: "2026-04-15T00:00:00.000Z",
        end_at: "2026-04-15T03:30:00.000Z",
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(CONFLICTS_KEY, []);

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-15T04:00:00.000Z"));

    const wrapper = mount(SchedulePage, { attachTo: document.body });
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toEqual([]);
    expect(getStorage(TASKS_KEY)).toEqual([expect.objectContaining({ code: "TASK-001", status: STATUS_WAITING })]);
    expect(getStorage(CONFLICTS_KEY)).toEqual([
      expect.objectContaining({
        schedule_id: "schedule-1",
        status: "pending",
        task_code: "TASK-001",
        type: "schedule_missed_start",
      }),
    ]);
    const createdConflictId = getStorage(CONFLICTS_KEY)[0].id;
    await settle(wrapper);
    expect(String(document.body.querySelector('[data-testid="schedule-exception-action"]')?.textContent || "").trim()).toBe("异常处理 1");

    document.body.querySelector('[data-testid="schedule-exception-action"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle(wrapper);

    expect(wrapper.find('[data-testid="schedule-exception-modal"].is-open').exists()).toBe(true);
    expect(wrapper.text()).toContain("TASK-001");
    expect(wrapper.text()).toContain("排程时段内未开始实验，系统已自动撤销排程");

    await wrapper.get(`[data-testid="schedule-exception-acknowledge-${createdConflictId}"]`).trigger("click");
    await settle(wrapper);

    expect(getStorage(CONFLICTS_KEY)).toEqual([
      expect.objectContaining({
        id: createdConflictId,
        status: "acknowledged",
      }),
    ]);
    expect(String(document.body.querySelector('[data-testid="schedule-exception-action"]')?.textContent || "").trim()).toBe("异常处理");

    vi.useRealTimers();
    wrapper.unmount();
  });

  test("creates, edits, and deletes a schedule from Vue state", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Task A", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-01-001");
    await settle(wrapper);
    await wrapper.get('select[name="device"]').setValue(PRIMARY_LAB);
    await wrapper.get('input[name="schedule_date"]').setValue(future.isoDate);
    await wrapper.get('select[name="time_slot"]').setValue("morning");
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(1);
    expect(getStorage(TASKS_KEY)[0].status).toBe(STATUS_SCHEDULED);
    expect(wrapper.findAll("#schedule-table tbody tr")).toHaveLength(1);

    await wrapper.get('[data-testid="open-schedule-drawer-0"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.find(".drawer.is-open").exists()).toBe(true);

    await wrapper.get('[data-testid="schedule-edit-device"]').setValue(SECONDARY_LAB);
    await wrapper.get('[data-testid="schedule-update"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)[0].device).toBe(SECONDARY_LAB);

    await wrapper.get('[data-testid="open-schedule-drawer-0"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="schedule-delete"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(0);
    expect(getStorage(TASKS_KEY)[0].status).toBe(STATUS_WAITING);
  });

  test("supports experiment-level scheduling selection and renders experiment labels", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-03-006", name: "四综合任务", test_type: "四综合试验", status: STATUS_WAITING, tray_codes: ["SYLU-2026-03-006-TP-002"] },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      {
        id: "SYLU-2026-03-006-A",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-A",
        experiment_name: "四综合试验",
        required_device: PRIMARY_LAB,
      },
      {
        id: "SYLU-2026-03-006-B",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-B",
        experiment_name: "振动试验",
        required_device: SECONDARY_LAB,
        axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
      },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-03-006");
    await settle(wrapper);

    expect(wrapper.get('select[name="experiment_code"]').text()).toContain("四综合试验");
    expect(wrapper.get('select[name="experiment_code"]').text()).toContain("振动试验");

    await wrapper.get('select[name="experiment_code"]').setValue("SYLU-2026-03-006-B");
    await settle(wrapper);
    await wrapper.get('select[name="device"]').setValue(SECONDARY_LAB);
    await wrapper.get('input[name="schedule_date"]').setValue(future.isoDate);
    await wrapper.get('select[name="time_slot"]').setValue("morning");
    for (const testId of ["x-plus", "x-minus", "y-plus", "y-minus", "z-plus", "z-minus"]) {
      await wrapper.get(`[data-testid="schedule-axis-option-${testId}"]`).trigger("click");
    }
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(1);
    expect(getStorage(SCHEDULES_KEY)[0].experiment_code).toBe("SYLU-2026-03-006-B");
    expect(getStorage(SCHEDULES_KEY)[0].axis_codes).toEqual(["x+", "x-", "y+", "y-", "z+", "z-"]);
    expect(wrapper.text()).toContain("振动试验");
  });

  test("shows dispatched vibration axis requirements and lets this schedule choose axes", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      {
        id: "task-axis",
        code: "SYLU-2026-06-201",
        name: "振动轴向任务",
        test_type: "振动试验",
        status: STATUS_WAITING,
        tray_codes: ["SYLU-2026-06-201-TP-001"],
      },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      {
        id: "SYLU-2026-06-201-A",
        task_code: "SYLU-2026-06-201",
        experiment_code: "SYLU-2026-06-201-A",
        experiment_name: "振动试验",
        required_device: SECONDARY_LAB,
        axis_codes: ["y+", "x-"],
      },
    ]);
    setStorage(DEVICES_KEY, [{ code: SECONDARY_LAB, name: SECONDARY_LAB }]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-06-201");
    await settle(wrapper);

    expect(wrapper.find('[data-testid="schedule-axis-selector"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="schedule-axis-selector"]').text()).toContain("剩余轴向");
    expect(wrapper.get('[data-testid="schedule-axis-selector"]').text()).not.toContain("本次排程");
    expect(wrapper.findAll('[data-testid^="schedule-axis-requirement-"]').map((tag) => tag.text())).toEqual([
      "X-",
      "Y+",
    ]);
    expect(wrapper.find('[data-testid="schedule-axis-requirement-y-plus"]').element.tagName).toBe("SPAN");
    expect(wrapper.find('[data-testid="schedule-axis-requirement-x-minus"]').element.tagName).toBe("SPAN");
    expect(wrapper.findAll('[data-testid^="schedule-axis-option-"]').map((button) => button.text())).toEqual([
      "X-",
      "Y+",
    ]);
    expect(wrapper.find('[data-testid="schedule-axis-option-y-plus"]').element.tagName).toBe("BUTTON");
    expect(wrapper.find('[data-testid="schedule-axis-option-x-minus"]').element.tagName).toBe("BUTTON");
    expect(wrapper.find('[data-testid="schedule-axis-order"]').exists()).toBe(false);

    await wrapper.get('select[name="device"]').setValue(SECONDARY_LAB);
    await wrapper.get('input[name="schedule_date"]').setValue(future.isoDate);
    await wrapper.get('select[name="time_slot"]').setValue("custom");
    await wrapper.get('input[name="custom_start"]').setValue("08:00");
    await wrapper.get('input[name="planned_hours"]').setValue("1");
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("请选择轴向");
    expect(getStorage(SCHEDULES_KEY)).toHaveLength(0);

    await wrapper.get('[data-testid="schedule-axis-option-y-plus"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.get('[data-testid="schedule-axis-order"]').text()).toContain("Y+");
    expect(wrapper.get('[data-testid="schedule-axis-order"]').text()).not.toContain("X-");

    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(1);
    expect(getStorage(SCHEDULES_KEY).map((schedule) => schedule.axis_codes)).toEqual([["y+"]]);
    expect(getStorage(SCHEDULES_KEY).map((schedule) => schedule.device)).toEqual([SECONDARY_LAB]);
    expect(getStorage(SCHEDULES_KEY).map((schedule) => schedule.experiment_code)).toEqual(["SYLU-2026-06-201-A"]);
  });

  test("shows completed axes while only unfinished axes remain selectable", async () => {
    setStorage(TASKS_KEY, [
      {
        id: "task-axis-partial",
        code: "SYLU-2026-06-219",
        name: "冲击轴向任务",
        test_type: "冲击试验",
        status: "任务进行中",
        tray_codes: ["SYLU-2026-06-219-TP-001"],
      },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      {
        id: "SYLU-2026-06-219-A",
        task_code: "SYLU-2026-06-219",
        experiment_code: "SYLU-2026-06-219-A",
        experiment_name: "冲击试验",
        required_device: SECONDARY_LAB,
        axis_codes: ["x+", "x-", "y+"],
      },
    ]);
    setStorage(EXPERIMENT_RUNS_KEY, [
      {
        task_code: "SYLU-2026-06-219",
        experiment_code: "SYLU-2026-06-219-A",
        run_no: "run-axis-219",
        status: "实验进行中",
      },
    ]);
    setStorage(EXPERIMENT_RUN_STEPS_KEY, [
      {
        task_code: "SYLU-2026-06-219",
        experiment_code: "SYLU-2026-06-219-A",
        run_no: "run-axis-219",
        axis_code: "x+",
        status: "实验已完成",
      },
    ]);
    setStorage(DEVICES_KEY, [{ code: SECONDARY_LAB, name: SECONDARY_LAB }]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-06-219");
    await settle(wrapper);

    expect(wrapper.findAll('[data-testid^="schedule-axis-requirement-"]').map((tag) => tag.text())).toEqual([
      "X+",
      "X-",
      "Y+",
    ]);
    expect(wrapper.findAll('[data-testid^="schedule-axis-completed-"]').map((tag) => tag.text())).toEqual(["X+"]);
    expect(wrapper.findAll('[data-testid^="schedule-axis-option-"]').map((button) => button.text())).toEqual([
      "X-",
      "Y+",
    ]);
    expect(wrapper.find('[data-testid="schedule-axis-option-x-plus"]').exists()).toBe(false);
  });

  test("shows only atomic experiment types in the manual scheduling selector for legacy combined task types", async () => {
    setStorage(TASKS_KEY, [
      {
        id: "task-1",
        code: "SYLU-2026-03-006",
        name: "组合实验任务",
        test_type: "冲击试验 / 盐雾试验 / 冲击试验",
        status: STATUS_WAITING,
        experiment_codes: ["SYLU-2026-03-006-A", "SYLU-2026-03-006-B", "SYLU-2026-03-006-C"],
        tray_codes: ["SYLU-2026-03-006-TP-001"],
      },
    ]);
    setStorage(EXPERIMENTS_KEY, []);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("实验类型");

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-03-006");
    await settle(wrapper);

    const experimentSelect = wrapper.get('select[name="experiment_code"]');
    expect(experimentSelect.text()).toContain("冲击试验");
    expect(experimentSelect.text()).toContain("盐雾试验");
    expect(experimentSelect.text()).not.toContain("冲击试验 / 盐雾试验 / 冲击试验");
  });

  test("shows current task scheduled overlays in the gantt section when scheduling another experiment", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-03-006", name: "四综合任务", test_type: "四综合试验", status: STATUS_WAITING },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      {
        id: "SYLU-2026-03-006-A",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-A",
        experiment_name: "冲击试验",
        required_device: PRIMARY_LAB,
      },
      {
        id: "SYLU-2026-03-006-B",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-B",
        experiment_name: "振动试验",
        required_device: SECONDARY_LAB,
      },
    ]);
    setStorage(EXPERIMENT_TRAYS_KEY, [
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-002" },
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-003" },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-A",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T00:00:00.000Z`,
        end_at: `${future.isoDate}T04:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-03-006");
    await settle(wrapper);
    await wrapper.get('select[name="experiment_code"]').setValue("SYLU-2026-03-006-B");
    await settle(wrapper);

    expect(wrapper.text()).toContain("当前任务已排程");
    expect(wrapper.text()).toContain("冲击试验");
    expect(wrapper.text()).toContain("SYLU-2026-03-006-TP-001");
    expect(wrapper.find(".gantt-lab-nav").exists()).toBe(false);
  });

  test("shows a partial conflict modal and does not persist when scheduling is canceled", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-03-006", name: "四综合任务", test_type: "四综合试验", status: STATUS_WAITING },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      {
        id: "SYLU-2026-03-006-A",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-A",
        experiment_name: "冲击试验",
        required_device: PRIMARY_LAB,
      },
      {
        id: "SYLU-2026-03-006-B",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-B",
        experiment_name: "振动试验",
        required_device: SECONDARY_LAB,
      },
    ]);
    setStorage(EXPERIMENT_TRAYS_KEY, [
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-002" },
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-002" },
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", tray_code: "SYLU-2026-03-006-TP-003" },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-A",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T00:00:00.000Z`,
        end_at: `${future.isoDate}T04:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-03-006");
    await settle(wrapper);
    await wrapper.get('select[name="experiment_code"]').setValue("SYLU-2026-03-006-B");
    await settle(wrapper);
    await wrapper.get('select[name="device"]').setValue(SECONDARY_LAB);
    await wrapper.get('input[name="schedule_date"]').setValue(future.isoDate);
    await wrapper.get('select[name="time_slot"]').setValue("morning");
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("部分冲突提示");
    expect(wrapper.text()).toContain("SYLU-2026-03-006-TP-002");
    expect(wrapper.get(".modal-content").classes()).toContain("schedule-conflict-modal-content");
    expect(wrapper.get('[data-testid="schedule-conflict-modal"]').attributes()).toEqual(expect.objectContaining({
      "aria-label": "冲突排程详情，可上下滚动",
      role: "region",
      tabindex: "0",
    }));
    expect(wrapper.get('[data-testid="schedule-conflict-cancel"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="schedule-conflict-confirm"]').exists()).toBe(true);

    await wrapper.get('[data-testid="schedule-conflict-cancel"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).not.toContain("部分冲突提示");
    expect(getStorage(SCHEDULES_KEY)).toHaveLength(1);
  });

  test("shows a full conflict modal and persists after confirmation", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-03-006", name: "四综合任务", test_type: "四综合试验", status: STATUS_WAITING },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      {
        id: "SYLU-2026-03-006-A",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-A",
        experiment_name: "冲击试验",
        required_device: PRIMARY_LAB,
      },
      {
        id: "SYLU-2026-03-006-C",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-C",
        experiment_name: "温度冲击试验",
        required_device: SECONDARY_LAB,
      },
    ]);
    setStorage(EXPERIMENT_TRAYS_KEY, [
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-001" },
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", tray_code: "SYLU-2026-03-006-TP-002" },
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", tray_code: "SYLU-2026-03-006-TP-001" },
      { task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-C", tray_code: "SYLU-2026-03-006-TP-002" },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-03-006",
        experiment_code: "SYLU-2026-03-006-A",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T00:00:00.000Z`,
        end_at: `${future.isoDate}T04:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-03-006");
    await settle(wrapper);
    await wrapper.get('select[name="experiment_code"]').setValue("SYLU-2026-03-006-C");
    await settle(wrapper);
    await wrapper.get('select[name="device"]').setValue(SECONDARY_LAB);
    await wrapper.get('input[name="schedule_date"]').setValue(future.isoDate);
    await wrapper.get('select[name="time_slot"]').setValue("morning");
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("完全冲突提示");
    expect(wrapper.text()).toContain("SYLU-2026-03-006-TP-001");
    expect(wrapper.text()).toContain("SYLU-2026-03-006-TP-002");

    await wrapper.get('[data-testid="schedule-conflict-confirm"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).not.toContain("完全冲突提示");
    expect(getStorage(SCHEDULES_KEY)).toHaveLength(2);
    expect(getStorage(SCHEDULES_KEY)[1].experiment_code).toBe("SYLU-2026-03-006-C");
  });

  test("uses the task experiment type when no explicit experiment rows exist", async () => {
    setStorage(TASKS_KEY, [
      {
        id: "task-1",
        code: "SYLU-2026-04-105",
        name: "高低温湿热试验-批次E",
        test_type: "高低温湿热试验",
        status: STATUS_WAITING,
        created_at: "2026-03-05T09:00:00",
      },
    ]);
    setStorage(EXPERIMENTS_KEY, []);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-04-105");
    await settle(wrapper);

    const experimentSelect = wrapper.get('select[name="experiment_code"]');
    expect(experimentSelect.text()).toContain("高低温湿热试验");
    expect(experimentSelect.text()).not.toContain("冲击试验");
    expect(experimentSelect.text()).not.toContain("振动试验");
    expect(experimentSelect.element.value).toBe("SYLU-2026-04-105-A");
  });

  test("links task selection to lab options and keeps gantt scoped to task labs after a device is selected", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Task A", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "exp-1", task_code: "SYLU-2026-01-001", experiment_code: "SYLU-2026-01-001-A", experiment_name: "冲击试验", required_device: PRIMARY_LAB },
      { id: "exp-2", task_code: "SYLU-2026-01-001", experiment_code: "SYLU-2026-01-001-B", experiment_name: "冲击试验-备用", required_device: SECONDARY_LAB },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
      { code: TERTIARY_LAB, name: TERTIARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-01-001",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T08:00:00.000Z`,
        end_at: `${future.isoDate}T10:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
      {
        id: "schedule-2",
        task_code: "SYLU-2026-01-099",
        device: TERTIARY_LAB,
        start_at: `${future.isoDate}T08:00:00.000Z`,
        end_at: `${future.isoDate}T10:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-01-001");
    await settle(wrapper);

    const deviceSelectText = wrapper.get('select[name="device"]').text();
    expect(deviceSelectText).toContain(PRIMARY_LAB);
    expect(deviceSelectText).not.toContain(SECONDARY_LAB);
    expect(deviceSelectText).not.toContain(TERTIARY_LAB);

    await wrapper.get('select[name="device"]').setValue(PRIMARY_LAB);
    await settle(wrapper);

    const ganttRows = wrapper.findAll("#gantt-body tr");
    expect(ganttRows).toHaveLength(2);
    expect(ganttRows[0].text()).toContain(PRIMARY_LAB);
    expect(ganttRows[1].text()).toContain(SECONDARY_LAB);
  });

  test("uses master lab data in the manual device selector", async () => {
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验" },
      { code: "AREA_STAGING", name: RETENTION_DEVICE, type: "暂存间", testTypeName: "盐雾试验" },
    ];
    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Task A", test_type: "盐雾试验", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "exp-1", task_code: "SYLU-2026-01-001", experiment_code: "SYLU-2026-01-001-A", experiment_name: "盐雾试验", required_device: "盐雾试验" },
    ]);
    setStorage(DEVICES_KEY, []);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-01-001");
    await settle(wrapper);

    const deviceSelectText = wrapper.get('select[name="device"]').text();
    const deviceOptions = wrapper.findAll('select[name="device"] option').map((option) => option.text());
    expect(deviceSelectText).toContain("盐雾试验室");
    expect(deviceSelectText).not.toContain(RETENTION_DEVICE);
    expect(deviceOptions.filter((option) => option === "盐雾试验室")).toHaveLength(1);
  });

  test("keeps static lab options when the master labs endpoint fails", async () => {
    masterLabsShouldFail = true;
    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Task A", test_type: "盐雾试验", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "exp-1", task_code: "SYLU-2026-01-001", experiment_code: "SYLU-2026-01-001-A", experiment_name: "盐雾试验", required_device: "盐雾试验" },
    ]);
    setStorage(DEVICES_KEY, []);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-01-001");
    await settle(wrapper);

    expect(wrapper.get('select[name="device"]').text()).toContain("盐雾试验室");
  });

  test("filters gantt rows to the selected task labs", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-03-006", name: "Task A", test_type: "冲击试验", status: STATUS_WAITING, tray_codes: ["SYLU-2026-03-006-TP-001"] },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "exp-1", task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-A", experiment_name: "冲击试验", required_device: PRIMARY_LAB },
      { id: "exp-2", task_code: "SYLU-2026-03-006", experiment_code: "SYLU-2026-03-006-B", experiment_name: "冲击试验-备用", required_device: SECONDARY_LAB },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
      { code: TERTIARY_LAB, name: TERTIARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "OTHER-001",
        device: TERTIARY_LAB,
        start_at: `${future.isoDate}T08:00:00.000Z`,
        end_at: `${future.isoDate}T10:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-03-006");
    await settle(wrapper);

    const ganttRows = wrapper.findAll("#gantt-body tr");
    expect(ganttRows).toHaveLength(2);
    expect(ganttRows[0].text()).toContain(PRIMARY_LAB);
    expect(ganttRows[1].text()).toContain(SECONDARY_LAB);
  });

  test("shows maintenance devices as maintenance in the central schedule gantt", async () => {
    setStorage(TASKS_KEY, []);
    setStorage(EXPERIMENTS_KEY, []);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB, status: "维修" }]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const firstRow = wrapper.findAll("#gantt-body tr").find((row) => row.text().includes(PRIMARY_LAB));
    expect(firstRow).toBeTruthy();
    expect(firstRow.text()).toContain("维修中");
    expect(firstRow.find(".gantt-slot.maintenance").exists()).toBe(true);
  });

  test("shows maintenance before a task that starts after maintenance ends in the same morning gantt cell", async () => {
    const future = buildDateParts(2);
    setStorage(TASKS_KEY, [
      { id: "task-comprehensive", code: "TASK-COMPREHENSIVE", name: "四综合任务", test_type: "四综合试验", status: STATUS_SCHEDULED },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      {
        id: "TASK-COMPREHENSIVE-A",
        task_code: "TASK-COMPREHENSIVE",
        experiment_code: "TASK-COMPREHENSIVE-A",
        experiment_name: "四综合试验",
        required_device: PRIMARY_LAB,
      },
    ]);
    setStorage(DEVICES_KEY, [
      {
        code: PRIMARY_LAB,
        name: PRIMARY_LAB,
        maintenance_start_at: `${future.isoDate}T08:00`,
        maintenance_end_at: `${future.isoDate}T10:30`,
        status: "可用",
      },
    ]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-comprehensive",
        task_code: "TASK-COMPREHENSIVE",
        experiment_code: "TASK-COMPREHENSIVE-A",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T10:33:00`,
        end_at: `${future.isoDate}T11:30:00`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const mixedCell = wrapper.get(`[data-testid="gantt-segment-mixed-${PRIMARY_LAB}-${future.isoDate}-am"]`);
    expect(mixedCell.text()).toContain("TASK-COMPREHENSIVE");
    expect(mixedCell.text()).toContain("维修中");
    expect(mixedCell.find(".gantt-slot--mixed").exists()).toBe(true);
    const taskItem = mixedCell.get('[data-testid="gantt-task-item-schedule-comprehensive"]');
    const maintenanceItem = mixedCell.get(".gantt-maintenance-item");
    expect(taskItem.attributes("style")).not.toContain("width:");
    expect(taskItem.attributes("style")).not.toContain("left:");
    expect(taskItem.attributes("title")).toContain("10:33");
    expect(taskItem.attributes("title")).toContain("11:30");
    expect(maintenanceItem.attributes("title")).toContain("10:30");
    const timelineItems = mixedCell.get(".gantt-slot-content--mixed").element.children;
    expect(timelineItems[0]).toBe(maintenanceItem.element);
    expect(timelineItems[1]).toBe(taskItem.element);
    const mixedGroupLabel = mixedCell.get(".gantt-slot--mixed").attributes("aria-label");
    expect(mixedGroupLabel.indexOf("维修")).toBeLessThan(mixedGroupLabel.indexOf("TASK-COMPREHENSIVE"));

    await taskItem.trigger("click");
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("任务详情");
  });

  test("renders stacked task codes inside one half-day gantt cell", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "TASK-001", name: "Task 1", test_type: "冲击试验", status: STATUS_SCHEDULED },
      { id: "task-2", code: "TASK-002", name: "Task 2", test_type: "冲击试验", status: STATUS_SCHEDULED },
      { id: "task-3", code: "TASK-003", name: "Task 3", test_type: "冲击试验", status: STATUS_SCHEDULED },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "TASK-001",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T00:00:00.000Z`,
        end_at: `${future.isoDate}T01:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
      {
        id: "schedule-2",
        task_code: "TASK-002",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T01:30:00.000Z`,
        end_at: `${future.isoDate}T02:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
      {
        id: "schedule-3",
        task_code: "TASK-003",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T02:30:00.000Z`,
        end_at: `${future.isoDate}T03:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const stackedCell = wrapper.get('[data-testid="gantt-segment-stack-冲击一室-' + future.isoDate + '-am"]');
    expect(stackedCell.text()).toContain("TASK-001");
    expect(stackedCell.text()).toContain("TASK-002");
    expect(stackedCell.text()).toContain("+1");
  });

  test("renders exactly two tasks in one half-day gantt cell as a split layout with hover details", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "TASK-001", name: "Task 1", test_type: "冲击试验", status: STATUS_SCHEDULED },
      { id: "task-2", code: "TASK-002", name: "Task 2", test_type: "冲击试验", status: STATUS_SCHEDULED },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "TASK-001-A", task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "A实验", required_device: PRIMARY_LAB },
      { id: "TASK-002-B", task_code: "TASK-002", experiment_code: "TASK-002-B", experiment_name: "B实验", required_device: PRIMARY_LAB },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T00:00:00.000Z`,
        end_at: `${future.isoDate}T01:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
      {
        id: "schedule-2",
        task_code: "TASK-002",
        experiment_code: "TASK-002-B",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T01:30:00.000Z`,
        end_at: `${future.isoDate}T03:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const splitCell = wrapper.get(`[data-testid="gantt-segment-split-${PRIMARY_LAB}-${future.isoDate}-am"]`);
    expect(splitCell.text()).toContain("TASK-001");
    expect(splitCell.text()).toContain("TASK-002");
    expect(splitCell.find(".gantt-slot--split").exists()).toBe(true);
    const title = splitCell.get(".gantt-slot--split").attributes("title");
    expect(title).toContain("TASK-001 / A实验");
    expect(title).toContain("TASK-002 / B实验");
    expect(title).toContain("08:00");
    expect(title).toContain("11:00");
  });

  test("opens the selected task detail from a split gantt cell task code", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "TASK-001", name: "Task 1", test_type: "冲击试验", source: "内部新增", priority: "中", status: STATUS_SCHEDULED },
      { id: "task-2", code: "TASK-002", name: "Task 2", test_type: "冲击试验", source: "外部委托", priority: "高", status: STATUS_SCHEDULED },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "TASK-001-A", task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "A实验", required_device: PRIMARY_LAB },
      { id: "TASK-002-B", task_code: "TASK-002", experiment_code: "TASK-002-B", experiment_name: "B实验", required_device: PRIMARY_LAB },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        device: PRIMARY_LAB,
        planned_hours: 1,
        start_at: `${future.isoDate}T00:00:00.000Z`,
        end_at: `${future.isoDate}T01:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
      {
        id: "schedule-2",
        task_code: "TASK-002",
        experiment_code: "TASK-002-B",
        device: PRIMARY_LAB,
        planned_hours: 1.5,
        start_at: `${future.isoDate}T01:30:00.000Z`,
        end_at: `${future.isoDate}T03:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('[data-testid="gantt-task-item-schedule-2"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("任务详情");
    expect(wrapper.text()).toContain("TASK-002");
    expect(wrapper.text()).toContain("B实验");
  });

  test("opens adjacent gantt schedules as separate axis details", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      {
        id: "task-axis-merge",
        code: "SYLU-2026-06-022",
        name: "414",
        test_type: "冲击试验 / 振动试验",
        source: "内部新增",
        priority: "高",
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      {
        id: "SYLU-2026-06-022-A",
        task_code: "SYLU-2026-06-022",
        experiment_code: "SYLU-2026-06-022-A",
        experiment_name: "冲击试验",
        required_device: PRIMARY_LAB,
      },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-axis-am",
        axis_codes: ["z+"],
        task_code: "SYLU-2026-06-022",
        experiment_code: "SYLU-2026-06-022-A",
        device: PRIMARY_LAB,
        planned_hours: 2,
        start_at: `${future.isoDate}T00:00:00.000Z`,
        end_at: `${future.isoDate}T04:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
      {
        id: "schedule-axis-pm",
        axis_codes: ["z-"],
        task_code: "SYLU-2026-06-022",
        experiment_code: "SYLU-2026-06-022-A",
        device: PRIMARY_LAB,
        planned_hours: 1.5,
        start_at: `${future.isoDate}T04:00:00.000Z`,
        end_at: `${future.isoDate}T10:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('[data-testid="gantt-segment-schedule-axis-am"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    const values = wrapper.findAll(".modal.is-open input").map((input) => input.element.value);
    expect(values).toContain("SYLU-2026-06-022");
    expect(values).toContain("Z+");
    expect(values).not.toContain("Z+ / Z-");
    expect(values).toContain("2");
  });

  test("opens stacked gantt overflow tasks in a modal and then opens task detail", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "TASK-001", name: "Task 1", test_type: "冲击试验", source: "内部新增", priority: "中", status: STATUS_SCHEDULED },
      { id: "task-2", code: "TASK-002", name: "Task 2", test_type: "冲击试验", source: "外部委托", priority: "高", status: STATUS_SCHEDULED },
      { id: "task-3", code: "TASK-003", name: "Task 3", test_type: "冲击试验", source: "外部委托", priority: "高", status: STATUS_SCHEDULED },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "TASK-001-A", task_code: "TASK-001", experiment_code: "TASK-001-A", experiment_name: "A实验", required_device: PRIMARY_LAB },
      { id: "TASK-002-B", task_code: "TASK-002", experiment_code: "TASK-002-B", experiment_name: "B实验", required_device: PRIMARY_LAB },
      { id: "TASK-003-C", task_code: "TASK-003", experiment_code: "TASK-003-C", experiment_name: "C实验", required_device: PRIMARY_LAB },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        device: PRIMARY_LAB,
        planned_hours: 1,
        start_at: `${future.isoDate}T00:00:00.000Z`,
        end_at: `${future.isoDate}T01:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
      {
        id: "schedule-2",
        task_code: "TASK-002",
        experiment_code: "TASK-002-B",
        device: PRIMARY_LAB,
        planned_hours: 0.5,
        start_at: `${future.isoDate}T01:30:00.000Z`,
        end_at: `${future.isoDate}T02:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
      {
        id: "schedule-3",
        task_code: "TASK-003",
        experiment_code: "TASK-003-C",
        device: PRIMARY_LAB,
        planned_hours: 1,
        start_at: `${future.isoDate}T02:30:00.000Z`,
        end_at: `${future.isoDate}T03:30:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get(`[data-testid="gantt-overflow-${PRIMARY_LAB}-${future.isoDate}-am"]`).trigger("click");
    await settle(wrapper);

    expect(wrapper.find('[data-testid="gantt-overflow-modal"]').exists()).toBe(true);
    expect(wrapper.text()).toContain("TASK-003");
    expect(wrapper.text()).toContain("C实验");

    await wrapper.get('[data-testid="gantt-overflow-task-schedule-3"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("任务详情");
    expect(wrapper.text()).toContain("TASK-003");
    expect(wrapper.text()).toContain("C实验");
  });

  test("keeps unstarted gantt schedules visible after their planned end time has passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-20T08:00:00"));

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "TASK-001", name: "Task 1", test_type: "冲击试验", status: STATUS_SCHEDULED },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "TASK-001",
        experiment_code: "TASK-001-A",
        device: PRIMARY_LAB,
        start_at: "2099-03-20T00:00:00.000Z",
        end_at: "2099-03-20T02:00:00.000Z",
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    expect(wrapper.find('[data-testid="gantt-segment-schedule-1"]').exists()).toBe(true);
    expect(wrapper.get("#gantt-body tr").text()).toContain("TASK-001");

    vi.useRealTimers();
  });

  test("resets selected lab when switching manual schedule task", async () => {
    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Task A", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
      { id: "task-2", code: "SYLU-2026-01-002", name: "Task B", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-002-TP-001"] },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
      { code: TERTIARY_LAB, name: TERTIARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const taskSelect = wrapper.get('select[name="task_code"]');
    const deviceSelect = wrapper.get('select[name="device"]');

    await taskSelect.setValue("SYLU-2026-01-002");
    await settle(wrapper);
    await deviceSelect.setValue(PRIMARY_LAB);
    await settle(wrapper);

    expect(deviceSelect.element.value).toBe(PRIMARY_LAB);

    await taskSelect.setValue("SYLU-2026-01-001");
    await settle(wrapper);

    expect(deviceSelect.element.value).toBe("");
  });

  test("does not offer retention as a schedulable device and keeps gantt busy classes intact", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-002", name: "Task B", test_type: "UNKNOWN", status: STATUS_WAITING },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-01-002",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T08:00:00.000Z`,
        end_at: `${future.isoDate}T10:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-01-002");
    await settle(wrapper);

    expect(wrapper.get('select[name="device"]').text()).not.toContain(RETENTION_DEVICE);

    const firstBusySlot = wrapper.find(".gantt-slot.busy");
    expect(firstBusySlot.exists()).toBe(true);
  });

  test("creates and edits schedules with planned hours from the Vue forms", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Cross Day Task", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-01-001");
    await settle(wrapper);
    await wrapper.get('select[name="device"]').setValue(PRIMARY_LAB);
    await wrapper.get('input[name="schedule_date"]').setValue(future.isoDate);
    await wrapper.get('select[name="time_slot"]').setValue("morning");
    await wrapper.get('[data-testid="schedule-duration-unit-days"]').trigger("click");
    expect(wrapper.get('[data-testid="schedule-duration-unit-days"]').classes()).toContain("is-active");
    expect(wrapper.get('[data-testid="schedule-duration-unit-hours"]').classes()).not.toContain("is-active");
    await wrapper.get('input[name="planned_hours"]').setValue("15");
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(1);
    expect(getStorage(SCHEDULES_KEY)[0].planned_hours).toBe(360);

    await wrapper.get('[data-testid="open-schedule-drawer-0"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="edit-duration-unit-days"]').classes()).toContain("is-active");
    expect(wrapper.get('input[name="edit_planned_hours"]').element.value).toBe("15");
    expect(wrapper.get('input[name="edit_planned_hours"]').attributes("min")).toBe("0.5");
    expect(wrapper.get('input[name="edit_planned_hours"]').attributes("step")).toBe("0.5");
    await wrapper.get('[data-testid="edit-duration-unit-hours"]').trigger("click");
    expect(wrapper.get('[data-testid="edit-duration-unit-hours"]').classes()).toContain("is-active");
    expect(wrapper.get('input[name="edit_planned_hours"]').element.value).toBe("360");
    expect(wrapper.get('input[name="edit_planned_hours"]').attributes("min")).toBe("0.1");
    expect(wrapper.get('input[name="edit_planned_hours"]').attributes("step")).toBe("0.1");
    await wrapper.get('input[name="edit_planned_hours"]').setValue("1.5");
    await wrapper.get('[data-testid="schedule-edit-device"]').setValue(SECONDARY_LAB);
    await wrapper.get('[data-testid="schedule-update"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)[0].planned_hours).toBe(1.5);
  });

  test("supports saving half-day durations from the duration toggle", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Cross Day Task", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-01-001");
    await settle(wrapper);
    await wrapper.get('select[name="device"]').setValue(PRIMARY_LAB);
    await wrapper.get('input[name="schedule_date"]').setValue(future.isoDate);
    await wrapper.get('select[name="time_slot"]').setValue("custom");
    await wrapper.get('input[name="custom_start"]').setValue("09:30");
    await wrapper.get('[data-testid="schedule-duration-unit-days"]').trigger("click");
    await wrapper.get('input[name="planned_hours"]').setValue("0.5");
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(1);
    expect(getStorage(SCHEDULES_KEY)[0].planned_hours).toBe(12);
  });

  test("limits duration input by selected unit to avoid oversized schedules", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Bounded Duration Task", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const durationInput = wrapper.get('input[name="planned_hours"]');
    expect(durationInput.element.value).toBe("1");
    expect(durationInput.attributes("min")).toBe("0.1");
    expect(durationInput.attributes("max")).toBe("9999");
    expect(durationInput.attributes("step")).toBe("0.1");
    await durationInput.setValue("0.5");
    await wrapper.get('.schedule-duration-control [data-testid="number-step-down"]').trigger("click");
    expect(wrapper.get('input[name="planned_hours"]').element.value).toBe("0.4");
    await wrapper.get('.schedule-duration-control [data-testid="number-step-up"]').trigger("click");
    expect(wrapper.get('input[name="planned_hours"]').element.value).toBe("0.5");
    await wrapper.get('.schedule-duration-control [data-testid="number-step-up"]').trigger("click");
    expect(wrapper.get('input[name="planned_hours"]').element.value).toBe("1");

    await wrapper.get('[data-testid="schedule-duration-unit-days"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.get('input[name="planned_hours"]').attributes("min")).toBe("0.5");
    expect(wrapper.get('input[name="planned_hours"]').attributes("max")).toBe("99");
    expect(wrapper.get('input[name="planned_hours"]').attributes("step")).toBe("0.5");

    await wrapper.get('select[name="task_code"]').setValue("SYLU-2026-01-001");
    await settle(wrapper);
    await wrapper.get('select[name="device"]').setValue(PRIMARY_LAB);
    await wrapper.get('input[name="schedule_date"]').setValue(future.isoDate);
    await wrapper.get('select[name="time_slot"]').setValue("custom");
    await wrapper.get('input[name="custom_start"]').setValue("09:30");
    await wrapper.get('input[name="planned_hours"]').setValue("999999999");
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(1);
    expect(getStorage(SCHEDULES_KEY)[0].planned_hours).toBe(99 * 24);
  });

  test("renders a cross-day gantt segment only inside the fixed three-day window", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "Cross Day Task", test_type: "UNKNOWN", status: STATUS_SCHEDULED },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-01-001",
        device: PRIMARY_LAB,
        planned_hours: 80,
        start_at: `${future.isoDate}T08:00:00.000Z`,
        end_at: `${buildDateParts(5).isoDate}T16:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const crossDaySegment = wrapper.get('[data-testid="gantt-segment-schedule-1"]');
    expect(Number(crossDaySegment.attributes("colspan"))).toBe(1);
    expect(crossDaySegment.text()).toContain("SYLU-2026-01-001");
  });

  test("opens centered task detail modal from gantt segments and shows estimated completion time", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      {
        id: "task-1",
        code: "SYLU-2026-01-001",
        name: "Cross Day Task",
        test_type: "UNKNOWN",
        source: "内部新增",
        priority: "高",
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-01-001",
        device: PRIMARY_LAB,
        planned_hours: 26.5,
        start_at: `${future.isoDate}T08:00:00.000Z`,
        end_at: `${buildDateParts(3).isoDate}T10:30:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('[data-testid="gantt-segment-schedule-1"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.find(".drawer.is-open").exists()).toBe(false);
    expect(wrapper.text()).toContain("任务详情");
    expect(wrapper.text()).toContain("预计完成时间");
    expect(wrapper.text()).toContain("SYLU-2026-01-001");
  });

  test("shows delete actions in task detail and can delete then backfill the top form for re-scheduling", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      {
        id: "task-1",
        code: "SYLU-2026-01-001",
        name: "Cross Day Task",
        test_type: "UNKNOWN",
        source: "内部新增",
        priority: "高",
        status: STATUS_SCHEDULED,
        tray_codes: ["SYLU-2026-01-001-TP-001"],
      },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      {
        id: "SYLU-2026-01-001-A",
        task_code: "SYLU-2026-01-001",
        experiment_code: "SYLU-2026-01-001-A",
        experiment_name: "冲击试验",
        required_device: PRIMARY_LAB,
      },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-01-001",
        experiment_code: "SYLU-2026-01-001-A",
        device: PRIMARY_LAB,
        planned_hours: 4,
        start_at: `${future.isoDate}T00:00:00.000Z`,
        end_at: `${future.isoDate}T04:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    await wrapper.get('[data-testid="gantt-segment-schedule-1"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="task-detail-delete"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="task-detail-reschedule"]').exists()).toBe(true);

    await wrapper.get('[data-testid="task-detail-reschedule"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(0);
    expect(wrapper.find(".modal.is-open").exists()).toBe(false);
    expect(wrapper.get('select[name="task_code"]').element.value).toBe("SYLU-2026-01-001");
    expect(wrapper.get('select[name="experiment_code"]').element.value).toBe("SYLU-2026-01-001-A");
    expect(wrapper.get('select[name="device"]').element.value).toBe(PRIMARY_LAB);
  });

  test("only shows tasks with saved tray plans in the unified schedule task selector", async () => {
    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-001", name: "已预接驳任务", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-001-TP-001"] },
      { id: "task-2", code: "SYLU-2026-01-002", name: "未预接驳任务", test_type: "UNKNOWN", status: STATUS_WAITING },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "SYLU-2026-01-001-A", task_code: "SYLU-2026-01-001", experiment_code: "SYLU-2026-01-001-A", experiment_name: "冲击试验", required_device: PRIMARY_LAB },
      { id: "SYLU-2026-01-002-A", task_code: "SYLU-2026-01-002", experiment_code: "SYLU-2026-01-002-A", experiment_name: "振动试验", required_device: SECONDARY_LAB },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const taskSelectText = wrapper.get('select[name="task_code"]').text();
    expect(taskSelectText).toContain("SYLU-2026-01-001");
    expect(taskSelectText).not.toContain("SYLU-2026-01-002");
  });

  test("keeps tray-assigned tasks visible in the selector when another task shares the same experiment label", async () => {
    setStorage(TASKS_KEY, [
      { id: "task-1", code: "SYLU-2026-01-010", name: "无托盘任务", test_type: "UNKNOWN", status: STATUS_WAITING },
      { id: "task-2", code: "SYLU-2026-01-011", name: "已分配托盘任务", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["SYLU-2026-01-011-TP-001"] },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "SYLU-2026-01-010-A", task_code: "SYLU-2026-01-010", experiment_code: "SYLU-2026-01-010-A", experiment_name: "冲击试验", required_device: PRIMARY_LAB },
      { id: "SYLU-2026-01-011-A", task_code: "SYLU-2026-01-011", experiment_code: "SYLU-2026-01-011-A", experiment_name: "冲击试验", required_device: PRIMARY_LAB },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const taskSelectText = wrapper.get('select[name="task_code"]').text();
    expect(taskSelectText).toContain("SYLU-2026-01-011");
    expect(taskSelectText).not.toContain("SYLU-2026-01-010");
  });

  test("auto-adjusts manual schedule slot to legal afternoon and next-day morning based on current time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-20T11:59:00"));

    setStorage(TASKS_KEY, []);
    setStorage(DEVICES_KEY, []);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    expect(wrapper.get('input[name="schedule_date"]').element.value).toBe("2099-03-20");
    expect(wrapper.get('select[name="time_slot"]').element.value).toBe("morning");

    vi.setSystemTime(new Date("2099-03-20T12:00:00"));
    vi.advanceTimersByTime(1000);
    await settle(wrapper);

    expect(wrapper.get('input[name="schedule_date"]').element.value).toBe("2099-03-20");
    expect(wrapper.get('select[name="time_slot"]').element.value).toBe("afternoon");

    vi.setSystemTime(new Date("2099-03-20T18:00:00"));
    vi.advanceTimersByTime(1000);
    await settle(wrapper);

    expect(wrapper.get('input[name="schedule_date"]').element.value).toBe("2099-03-21");
    expect(wrapper.get('select[name="time_slot"]').element.value).toBe("morning");

    vi.useRealTimers();
  });

  test("shows the effective current start time inside the active fixed-slot label", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-20T17:07:00"));

    setStorage(TASKS_KEY, []);
    setStorage(DEVICES_KEY, []);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    expect(wrapper.get('select[name="time_slot"]').text()).toContain("17:07");

    vi.useRealTimers();
  });

  test("shows the earliest remaining afternoon start after an existing laboratory schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-19T09:00:00"));

    setStorage(TASKS_KEY, [
      { id: "task-existing", code: "TASK-EXISTING", name: "Existing", test_type: "UNKNOWN", status: STATUS_SCHEDULED },
      { id: "task-new", code: "TASK-NEW", name: "New", test_type: "UNKNOWN", status: STATUS_WAITING, tray_codes: ["TASK-NEW-TP-001"] },
    ]);
    setStorage(EXPERIMENTS_KEY, [
      { id: "TASK-NEW-A", task_code: "TASK-NEW", experiment_code: "TASK-NEW-A", experiment_name: "盐雾试验", required_device: PRIMARY_LAB },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-existing",
        task_code: "TASK-EXISTING",
        experiment_code: "TASK-EXISTING-A",
        device: PRIMARY_LAB,
        planned_hours: 1,
        start_at: "2099-03-20T12:00:00",
        end_at: "2099-03-20T13:00:00",
        status: STATUS_SCHEDULED,
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);
    await wrapper.get('select[name="task_code"]').setValue("TASK-NEW");
    await settle(wrapper);
    await wrapper.get('select[name="device"]').setValue(PRIMARY_LAB);
    await wrapper.get('input[name="schedule_date"]').setValue("2099-03-20");
    await wrapper.get('input[name="planned_hours"]').setValue("1");
    await settle(wrapper);

    expect(wrapper.get('select[name="time_slot"]').text()).toContain("下午（12:00-18:00，最早 13:10 开始）");

    vi.useRealTimers();
  });

  test("shows updated slot hint labels in selector and gantt header", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-20T09:00:00"));

    setStorage(TASKS_KEY, []);
    setStorage(DEVICES_KEY, []);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const slotSelectText = wrapper.get('select[name="time_slot"]').text();
    expect(slotSelectText).toContain("上午（08:00-12:00");
    expect(slotSelectText).toContain("下午（12:00-18:00");

    const ganttHeaderText = wrapper.get("#gantt-table thead").text();
    expect(ganttHeaderText).toContain("上午 08:00-12:00");
    expect(ganttHeaderText).toContain("下午 12:00-18:00");

    vi.useRealTimers();
  });
});
