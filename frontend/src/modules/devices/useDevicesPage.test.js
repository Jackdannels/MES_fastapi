import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  persistSnapshot: vi.fn(),
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: mocks.loadSnapshot,
    persistSnapshot: mocks.persistSnapshot,
  }),
}));

import { useDevicesPage } from "./useDevicesPage";

const TestHarness = defineComponent({
  setup() {
    return useDevicesPage();
  },
  render() {
    return null;
  },
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("useDevicesPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-20T07:30:00"));
    mocks.persistSnapshot.mockResolvedValue(undefined);
    mocks.loadSnapshot.mockResolvedValue({
      "mes.devices": [
        { code: "冲击一室", name: "冲击试验系统-1", status: "可用" },
      ],
      "mes.experiment_trays": [],
      "mes.samples": [
        {
          task_code: "TASK-001",
          history: [{ action: "任务已确认入库", time: "2099-03-19T07:15:00.000Z" }],
          status: "到货",
          trays: [{ tray_code: "TASK-001-TP-001", status: "到货" }],
        },
      ],
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2099-03-20T10:00",
          experiment_code: "TASK-001-A",
          id: "schedule-1",
          start_at: "2099-03-20T08:00",
          status: "已排程",
          task_code: "TASK-001",
        },
      ],
      "mes.conflicts": [],
      "mes.experiments": [
        { experiment_code: "TASK-001-A", status: "已排程", task_code: "TASK-001" },
      ],
      "mes.tasks": [{ code: "TASK-001", status: "已排程" }],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.loadSnapshot.mockReset();
    mocks.persistSnapshot.mockReset();
  });

  test("opens conflict confirmation before saving an overlapping maintenance plan", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T09:00";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T11:00";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenanceConflictOpen).toBe(true);
    expect(wrapper.vm.maintenanceConflictDetail.conflictingSchedules).toEqual([
      expect.objectContaining({ id: "schedule-1" }),
    ]);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();

    await wrapper.vm.confirmMaintenanceConflict();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.schedules": [],
        "mes.conflicts": [
          expect.objectContaining({
            device: "冲击一室",
            detail: "冲击一室在排程期间维护，已自动删除",
            reason: "冲击一室在排程期间维护，已自动删除",
            schedule_id: "schedule-1",
            status: "pending",
            type: "device_maintenance_schedule_removed",
          }),
        ],
        "mes.devices": [
          expect.objectContaining({
            code: "冲击一室",
            maintenance_end_at: "2099-03-20T11:00",
            maintenance_start_at: "2099-03-20T09:00",
          }),
        ],
        "mes.experiments": [
          expect.objectContaining({
            experiment_code: "TASK-001-A",
            unscheduled_since: "2099-03-19T07:15:00.000Z",
          }),
        ],
      }),
    );
  });

  test("opens conflict confirmation before directly saving an unavailable device status", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);
    wrapper.vm.deviceForm.status = "停用";

    await wrapper.vm.saveEditedDevice();
    await settle(wrapper);

    expect(wrapper.vm.maintenanceConflictOpen).toBe(true);
    expect(wrapper.vm.maintenanceConflictDetail.conflictingSchedules).toEqual([
      expect.objectContaining({ id: "schedule-1" }),
    ]);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("refreshes planned maintenance status while the device page stays open", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "2099-03-20T09:00",
          maintenance_start_at: "2099-03-20T08:00",
          name: "冲击试验系统-1",
          status: "可用",
        },
      ],
      "mes.experiment_trays": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("可用");

    vi.setSystemTime(new Date("2099-03-20T08:01:00"));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("维护/校准");

    vi.setSystemTime(new Date("2099-03-20T09:01:00"));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("可用");
  });
});
