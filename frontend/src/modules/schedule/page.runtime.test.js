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
const EXPERIMENT_TRAYS_KEY = "mes.experiment_trays";

const PRIMARY_LAB = TEST_LABS[0];
const SECONDARY_LAB = TEST_LABS[1];
const TERTIARY_LAB = TEST_LABS[2];

let storageState = {};
let fetchMock = null;

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
};

const installStorageFetchMock = () => {
  fetchMock = vi.fn(async (input, options = {}) => {
    const url = String(input);
    const method = options.method ?? "GET";

    if (url.endsWith("/api/storage") && method === "GET") {
      return {
        ok: true,
        status: 200,
        json: async () => JSON.parse(JSON.stringify(storageState)),
      };
    }

    if (url.endsWith("/api/storage") && method === "PUT") {
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

    throw new Error(`Unhandled fetch: ${method} ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
};

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("SchedulePage runtime", () => {
  beforeEach(() => {
    resetStorage();
    installStorageFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorage();
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
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(1);
    expect(getStorage(SCHEDULES_KEY)[0].experiment_code).toBe("SYLU-2026-03-006-B");
    expect(wrapper.text()).toContain("振动试验");
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
    expect(wrapper.get('[data-testid="schedule-conflict-cancel"]').exists()).toBe(true);

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
    const title = splitCell.get("button").attributes("title");
    expect(title).toContain("TASK-001 / A实验");
    expect(title).toContain("TASK-002 / B实验");
    expect(title).toContain("08:00");
    expect(title).toContain("11:00");
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
    await wrapper.get('input[name="planned_hours"]').setValue("26.5");
    await wrapper.get('[data-testid="schedule-submit"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)).toHaveLength(1);
    expect(getStorage(SCHEDULES_KEY)[0].planned_hours).toBe(26.5);

    await wrapper.get('[data-testid="open-schedule-drawer-0"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('input[name="edit_planned_hours"]').setValue("1.5");
    await wrapper.get('[data-testid="schedule-edit-device"]').setValue(SECONDARY_LAB);
    await wrapper.get('[data-testid="schedule-update"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(SCHEDULES_KEY)[0].planned_hours).toBe(1.5);
  });

  test("renders a cross-day gantt segment as one continuous bar cell", async () => {
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
    expect(Number(crossDaySegment.attributes("colspan"))).toBeGreaterThan(2);
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

