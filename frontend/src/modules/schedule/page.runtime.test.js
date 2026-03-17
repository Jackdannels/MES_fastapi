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

const PRIMARY_LAB = TEST_LABS[0];
const SECONDARY_LAB = TEST_LABS[1];
const TERTIARY_LAB = TEST_LABS[2];

let storageState = {};

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

const createStorageStub = () => ({
  getItem: (key) => (Object.prototype.hasOwnProperty.call(storageState, key) ? storageState[key] : null),
  setItem: (key, value) => {
    storageState[key] = String(value);
  },
});

const setStorage = (key, value) => {
  window.localStorage.setItem(key, JSON.stringify(value));
};

const getStorage = (key) => JSON.parse(window.localStorage.getItem(key) || "[]");

const resetStorage = () => {
  storageState = {};
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
    vi.stubGlobal("localStorage", createStorageStub());
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorage();
  });

  test("switches tabs and renders gantt rows plus retention internal rows from Vue state", async () => {
    const today = buildDateParts(0);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "CJ-2026-001", name: "Task A", test_type: "UNKNOWN", status: STATUS_WAITING },
      { id: "task-2", code: "WDC-2026-001", name: "Task B", test_type: "UNKNOWN", status: STATUS_RETENTION },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-retention-1",
        task_code: "WDC-2026-001",
        device: RETENTION_DEVICE,
        start_at: today.isoMorningStart,
        end_at: today.isoMorningEnd,
        status: STATUS_RETENTION,
      },
    ]);
    setStorage(SAMPLES_KEY, [
      {
        id: "sample-1",
        code: "WDC-2026-001-SP-001",
        task_code: "WDC-2026-001",
        location: RETENTION_DEVICE,
        retention_source: "intake",
        created_at: today.isoMorningStart,
      },
    ]);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    expect(wrapper.findAll("#gantt-body tr").length).toBeGreaterThan(0);
    expect(wrapper.get('select[name="task_code"]').text()).toContain("CJ-2026-001");

    await wrapper.get('[data-testid="schedule-tab-retention"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.findAll("#retention-internal-table tbody tr").length).toBe(1);
    expect(wrapper.text()).toContain("WDC-2026-001");
  });

  test("creates, edits, and deletes a schedule from Vue state", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "CJ-2026-001", name: "Task A", test_type: "UNKNOWN", status: STATUS_WAITING },
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

    await wrapper.get('select[name="task_code"]').setValue("CJ-2026-001");
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

  test("links task selection to lab options and filters gantt rows by selected lab", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "CJ-2026-001", name: "Task A", test_type: "UNKNOWN", status: STATUS_WAITING },
    ]);
    setStorage(DEVICES_KEY, [
      { code: PRIMARY_LAB, name: PRIMARY_LAB },
      { code: SECONDARY_LAB, name: SECONDARY_LAB },
      { code: TERTIARY_LAB, name: TERTIARY_LAB },
    ]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "CJ-2026-001",
        device: PRIMARY_LAB,
        start_at: `${future.isoDate}T08:00:00.000Z`,
        end_at: `${future.isoDate}T10:00:00.000Z`,
        status: STATUS_SCHEDULED,
      },
      {
        id: "schedule-2",
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

    await wrapper.get('select[name="task_code"]').setValue("CJ-2026-001");
    await settle(wrapper);

    const deviceSelectText = wrapper.get('select[name="device"]').text();
    expect(deviceSelectText).toContain(PRIMARY_LAB);
    expect(deviceSelectText).toContain(SECONDARY_LAB);
    expect(deviceSelectText).toContain(TERTIARY_LAB);

    await wrapper.get('select[name="device"]').setValue(PRIMARY_LAB);
    await settle(wrapper);

    const ganttRows = wrapper.findAll("#gantt-body tr");
    expect(ganttRows).toHaveLength(1);
    expect(ganttRows[0].text()).toContain(PRIMARY_LAB);
  });

  test("resets selected lab when switching manual schedule task", async () => {
    setStorage(TASKS_KEY, [
      { id: "task-1", code: "CJ-2026-001", name: "Task A", test_type: "UNKNOWN", status: STATUS_WAITING },
      { id: "task-2", code: "WDC-2026-001", name: "Task B", test_type: "UNKNOWN", status: STATUS_WAITING },
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

    await taskSelect.setValue("WDC-2026-001");
    await settle(wrapper);
    await deviceSelect.setValue(PRIMARY_LAB);
    await settle(wrapper);

    expect(deviceSelect.element.value).toBe(PRIMARY_LAB);

    await taskSelect.setValue("CJ-2026-001");
    await settle(wrapper);

    expect(deviceSelect.element.value).toBe("");
  });

  test("locks manual time inputs when retention lab is selected and restores legacy gantt classes", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "WDC-2026-001", name: "Task B", test_type: "UNKNOWN", status: STATUS_WAITING },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "WDC-2026-001",
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

    await wrapper.get('select[name="task_code"]').setValue("WDC-2026-001");
    await settle(wrapper);

    await wrapper.get('select[name="device"]').setValue(RETENTION_DEVICE);
    await settle(wrapper);

    expect(wrapper.get('input[name="schedule_date"]').element.disabled).toBe(true);
    expect(wrapper.get('select[name="time_slot"]').element.closest(".form-field")?.classList.contains("is-hidden")).toBe(true);

    const firstBusySlot = wrapper.find(".gantt-slot.busy");
    expect(firstBusySlot.exists()).toBe(true);
  });

  test("creates and edits schedules with planned hours from the Vue forms", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      { id: "task-1", code: "CJ-2026-001", name: "Cross Day Task", test_type: "UNKNOWN", status: STATUS_WAITING },
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

    await wrapper.get('select[name="task_code"]').setValue("CJ-2026-001");
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
      { id: "task-1", code: "CJ-2026-001", name: "Cross Day Task", test_type: "UNKNOWN", status: STATUS_SCHEDULED },
    ]);
    setStorage(DEVICES_KEY, [{ code: PRIMARY_LAB, name: PRIMARY_LAB }]);
    setStorage(SCHEDULES_KEY, [
      {
        id: "schedule-1",
        task_code: "CJ-2026-001",
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
    expect(crossDaySegment.text()).toContain("CJ-2026-001");
  });

  test("opens centered task detail modal from gantt segments and shows estimated completion time", async () => {
    const future = buildDateParts(2);

    setStorage(TASKS_KEY, [
      {
        id: "task-1",
        code: "CJ-2026-001",
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
        task_code: "CJ-2026-001",
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
    expect(wrapper.text()).toContain("CJ-2026-001");
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

  test("shows updated slot hint labels in selector and gantt header", async () => {
    setStorage(TASKS_KEY, []);
    setStorage(DEVICES_KEY, []);
    setStorage(SCHEDULES_KEY, []);
    setStorage(SAMPLES_KEY, []);
    setStorage(STREAMS_KEY, []);

    const wrapper = mount(SchedulePage);
    await settle(wrapper);

    const slotSelectText = wrapper.get('select[name="time_slot"]').text();
    expect(slotSelectText).toContain("上午（08:00-12:00）");
    expect(slotSelectText).toContain("下午（12:00-18:00）");

    const ganttHeaderText = wrapper.get("#gantt-table thead").text();
    expect(ganttHeaderText).toContain("上午 08:00-12:00");
    expect(ganttHeaderText).toContain("下午 12:00-18:00");
  });
});
