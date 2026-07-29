import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadSnapshot: vi.fn(),
  persistRunningRepair: vi.fn(),
  persistSnapshot: vi.fn(),
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: mocks.loadSnapshot,
    persistRunningRepair: mocks.persistRunningRepair,
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

const buildRunningExperimentSnapshot = () => ({
  "mes.devices": [
    { code: "冲击一室", name: "冲击试验系统-1", status: "可用" },
  ],
  "mes.experiment_trays": [
    { experiment_code: "TASK-001-A", task_code: "TASK-001", tray_code: "TASK-001-TP-001" },
  ],
  "mes.experiment_runs": [
    {
      device: "冲击一室",
      experiment_code: "TASK-001-A",
      planned_end_at: "2099-03-20T10:00",
      run_no: "RUN-001",
      status: "实验进行中",
      task_code: "TASK-001",
      tray_codes: ["TASK-001-TP-001"],
    },
  ],
  "mes.samples": [
    {
      code: "TASK-001-SP-001",
      flow_status: "实验进行中",
      history: [
        {
          action: "实验完成",
          detail: "TASK-001 / 高低温试验 / 实验已完成",
          location: "高低温试验室",
          status: "实验已完成",
          time: "2099-03-19T07:15:00.000Z",
        },
      ],
      location: "冲击一室",
      status: "实验进行中",
      task_code: "TASK-001",
      trays: [{ tray_code: "TASK-001-TP-001", status: "实验进行中" }],
    },
  ],
  "mes.schedules": [
    {
      device: "冲击一室",
      end_at: "2099-03-20T10:00",
      experiment_code: "TASK-001-A",
      experiment_name: "冲击试验",
      id: "schedule-1",
      start_at: "2099-03-20T07:00",
      status: "实验进行中",
      task_code: "TASK-001",
    },
  ],
  "mes.conflicts": [],
  "mes.experiments": [
    { experiment_code: "TASK-001-A", experiment_name: "冲击试验", status: "实验进行中", task_code: "TASK-001" },
  ],
  "mes.tasks": [{ code: "TASK-001", status: "实验进行中" }],
});

describe("useDevicesPage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-20T07:30:00"));
    mocks.persistRunningRepair.mockResolvedValue(undefined);
    mocks.persistSnapshot.mockResolvedValue(undefined);
    mocks.loadSnapshot.mockResolvedValue({
      "mes.devices": [
        { code: "冲击一室", name: "冲击试验系统-1", status: "可用" },
      ],
      "mes.experiment_trays": [],
      "mes.experiment_runs": [],
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
    mocks.persistRunningRepair.mockReset();
    mocks.persistSnapshot.mockReset();
  });

  test("blocks saving an overlapping maintenance plan without deleting schedules", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T09:00";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T11:00";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenanceConflictOpen).toBe(false);
    expect(wrapper.vm.maintenanceConflictDetail).toBe(null);
    expect(wrapper.vm.maintenancePlanWarning).toBe("请先调整或删除该设备维修窗口内的排程");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("saves a same-day maintenance plan when the overlapping schedule is completed", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [{ code: "冲击一室", name: "冲击试验系统-1", status: "可用" }],
      "mes.experiment_trays": [],
      "mes.samples": [],
      "mes.schedules": [
        {
          device: "冲击一室",
          end_at: "2099-03-20T10:00",
          experiment_code: "TASK-001-A",
          id: "schedule-completed",
          start_at: "2099-03-20T08:00",
          status: "实验已完成",
          task_code: "TASK-001",
        },
      ],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T09:00";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T11:00";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanWarning).toBe("");
    expect(mocks.persistSnapshot).toHaveBeenCalled();
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

  test("uses lab code when checking unavailable device schedule conflicts", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        { code: "LAB_IMPACT_1", name: "冲击一室", status: "可用" },
      ],
      "mes.experiment_trays": [],
      "mes.experiment_runs": [],
      "mes.samples": [],
      "mes.schedules": [
        {
          device: "旧冲击间",
          end_at: "2099-03-20T10:00",
          experiment_code: "TASK-001-A",
          id: "schedule-code-match",
          lab_code: "LAB_IMPACT_1",
          start_at: "2099-03-20T08:00",
          status: "已排程",
          task_code: "TASK-001",
        },
        {
          device: "LAB_IMPACT_1",
          end_at: "2099-03-20T10:00",
          experiment_code: "TASK-002-A",
          id: "schedule-stale-name",
          lab_code: "LAB_IMPACT_2",
          start_at: "2099-03-20T08:00",
          status: "已排程",
          task_code: "TASK-002",
        },
      ],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);
    wrapper.vm.deviceForm.status = "停用";

    await wrapper.vm.saveEditedDevice();
    await settle(wrapper);

    expect(wrapper.vm.maintenanceConflictOpen).toBe(true);
    expect(wrapper.vm.maintenanceConflictDetail.conflictingSchedules).toEqual([
      expect.objectContaining({ id: "schedule-code-match" }),
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
          maintenance_type: "计划维修",
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

    expect(wrapper.vm.deviceRows[0].status).toBe("空闲");

    vi.setSystemTime(new Date("2099-03-20T08:01:00"));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("维修");
    expect(mocks.persistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      "mes.devices": [
        expect.objectContaining({
          code: "冲击一室",
          status: "维修",
        }),
      ],
    }));

    vi.setSystemTime(new Date("2099-03-20T09:01:00"));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("空闲");
    expect(mocks.persistSnapshot).toHaveBeenLastCalledWith({
      "mes.devices": [
        expect.objectContaining({
          code: "冲击一室",
          maintenance_end_at: "",
          maintenance_note: "",
          maintenance_start_at: "",
          maintenance_type: "",
          status: "可用",
        }),
      ],
      "mes.maintenance_records": [
        expect.objectContaining({
          device_code: "冲击一室",
          maintenance_type: "维修",
          status: "已结束",
        }),
      ],
    });
  });

  test("starts planned maintenance without an end time when the start time arrives", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "",
          maintenance_start_at: "2099-03-20T08:00",
          maintenance_type: "计划保养",
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

    expect(wrapper.vm.deviceRows[0].status).toBe("空闲");

    vi.setSystemTime(new Date("2099-03-20T08:01:00"));
    await vi.advanceTimersByTimeAsync(1000);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("保养");
    expect(mocks.persistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      "mes.devices": [
        expect.objectContaining({
          code: "冲击一室",
          status: "保养",
        }),
      ],
    }));
  });

  test("blocks immediate repair when an existing schedule falls after the start time", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-25T08:00";
    wrapper.vm.maintenancePlanForm.endAt = "";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenanceConflictOpen).toBe(false);
    expect(wrapper.vm.maintenancePlanWarning).toBe("请先调整或删除该设备维修窗口内的排程");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("persists maintenance for the backfilled second hot-humid room", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "高低温湿热一室",
          location: "高低温湿热一室",
          name: "高低温湿热系统-1",
          status: "可用",
          type: "高低温湿热试验",
        },
      ],
      "mes.experiment_trays": [],
      "mes.experiment_runs": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    const secondRoom = wrapper.vm.deviceRows.find((row) => row.code === "高低温湿热二室");
    wrapper.vm.openMaintenancePlan(secondRoom);
    wrapper.vm.maintenancePlanForm.type = "保养";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.devices": [
          expect.objectContaining({ code: "高低温湿热一室" }),
          expect.objectContaining({
            code: "高低温湿热二室",
            location: "高低温湿热二室",
            maintenance_start_at: "2099-03-20 07:30:00",
            maintenance_type: "保养",
            name: "高低温湿热系统-2",
            status: "保养",
            type: "高低温湿热试验",
          }),
        ],
      }),
    );
  });

  test("blocks planned maintenance without an end time when a later schedule exists", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划保养";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T09:00";
    wrapper.vm.maintenancePlanForm.endAt = "";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenanceConflictOpen).toBe(false);
    expect(wrapper.vm.maintenancePlanWarning).toBe("请先调整或删除该设备维修窗口内的排程");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("saves planned maintenance without an end time when no schedules overlap", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        { code: "冲击一室", name: "冲击试验系统-1", status: "可用" },
      ],
      "mes.experiment_trays": [],
      "mes.experiment_runs": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划保养";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T09:00";
    wrapper.vm.maintenancePlanForm.endAt = "";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanWarning).toBe("");
    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.devices": [
          expect.objectContaining({
            code: "冲击一室",
            maintenance_end_at: "",
            maintenance_start_at: "2099-03-20T09:00",
            maintenance_type: "计划保养",
            status: "可用",
          }),
        ],
      }),
    );
  });

  test("shows a warning when planned maintenance has no start time", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划维修";
    wrapper.vm.maintenancePlanForm.startAt = "";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T09:00";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanWarning).toBe("请选择开始时间");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("blocks planned maintenance while the device is running an experiment", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划维修";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T08:00";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T09:00";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(false);
    expect(wrapper.vm.maintenancePlanWarning).toBe("设备正在运行无法进行计划维修");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("shows a running warning when selecting care while the device is running an experiment", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "保养";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(false);
    expect(wrapper.vm.maintenancePlanWarning).toBe("设备正在运行无法进行保养");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("shows a running warning when selecting planned care while the device is running an experiment", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划保养";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(false);
    expect(wrapper.vm.maintenancePlanWarning).toBe("设备正在运行无法进行计划保养");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("requires a repair choice while the device is running an experiment", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(true);
    expect(wrapper.vm.maintenancePlanWarning).toBe("");
    expect(wrapper.vm.runningRepairChoiceDetail.runningSchedules).toEqual([
      expect.objectContaining({ id: "schedule-1" }),
    ]);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("reschedules the running experiment and rolls trays back to the previous stable state", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";
    await wrapper.vm.saveMaintenancePlan();
    await wrapper.vm.confirmRunningRepairReschedule();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        "mes.devices": [
          expect.objectContaining({
            code: "冲击一室",
            maintenance_start_at: "2099-03-20 07:30:00",
            maintenance_type: "维修",
            status: "维修",
          }),
        ],
        "mes.schedules": [],
        "mes.samples": [
          expect.objectContaining({
            flow_status: "实验已完成",
            location: "高低温试验室",
            status: "实验已完成",
            trays: [expect.objectContaining({ status: "实验已完成", tray_code: "TASK-001-TP-001" })],
          }),
        ],
        "mes.experiment_runs": [],
      }),
    );
  });

  test("completes the running experiment before saving the repair status", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";
    await wrapper.vm.saveMaintenancePlan();
    await wrapper.vm.confirmRunningRepairComplete();
    await settle(wrapper);

    expect(mocks.persistRunningRepair).toHaveBeenCalledWith({
      deviceCode: "冲击一室",
      maintenanceNote: "",
      targets: [expect.objectContaining({
        experiment_code: "TASK-001-A",
        id: "schedule-1",
        run_no: "RUN-001",
        task_code: "TASK-001",
      })],
    });
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("keeps the running repair confirmation open and shows an actionable error when the command fails", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce(buildRunningExperimentSnapshot());
    mocks.persistRunningRepair.mockRejectedValueOnce(new Error("当前实验状态已变化，请刷新后重试"));
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";
    await wrapper.vm.saveMaintenancePlan();
    await wrapper.vm.confirmRunningRepairComplete();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(true);
    expect(wrapper.vm.runningRepairChoiceWarning).toBe("当前实验状态已变化，请刷新后重试");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("detects a running repair conflict from experiment runs before sample refreshes", async () => {
    const snapshot = buildRunningExperimentSnapshot();
    snapshot["mes.samples"] = snapshot["mes.samples"].map((sample) => ({
      ...sample,
      flow_status: "实验准备就绪",
      status: "实验准备就绪",
      trays: [{ tray_code: "TASK-001-TP-001", status: "实验准备就绪" }],
    }));
    mocks.loadSnapshot.mockResolvedValueOnce(snapshot);
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "维修";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.runningRepairChoiceOpen).toBe(true);
    expect(wrapper.vm.runningRepairChoiceDetail.runningSchedules).toEqual([
      expect.objectContaining({ experiment_code: "TASK-001-A", task_code: "TASK-001" }),
    ]);
  });

  test("sets a device back to available and clears maintenance fields", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "2099-03-20T12:00",
          maintenance_note: "提前结束",
          maintenance_start_at: "2099-03-20T08:00",
          maintenance_type: "维修",
          name: "冲击试验系统-1",
          status: "维修",
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

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);
    await wrapper.vm.setDeviceAvailable();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      "mes.devices": [
        expect.objectContaining({
          code: "冲击一室",
          maintenance_end_at: "",
          maintenance_note: "",
          maintenance_start_at: "",
          maintenance_type: "",
          status: "可用",
        }),
      ],
      "mes.maintenance_records": [
        expect.objectContaining({
          device_code: "冲击一室",
          maintenance_note: "提前结束",
          maintenance_type: "维修",
          status: "已结束",
        }),
      ],
    }));
  });

  test("does not automatically reactivate a disabled device after its maintenance ends", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "2099-03-20T07:00",
          maintenance_note: "设备停用中",
          maintenance_start_at: "2099-03-20T06:00",
          maintenance_type: "计划保养",
          name: "冲击试验系统-1",
          status: "停用",
        },
      ],
      "mes.experiment_trays": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
      "mes.maintenance_records": [],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.deviceRows[0].status).toBe("停用");
    expect(mocks.persistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      "mes.devices": [
        expect.objectContaining({
          maintenance_end_at: "",
          maintenance_start_at: "",
          maintenance_type: "",
          status: "停用",
        }),
      ],
      "mes.maintenance_records": [
        expect.objectContaining({
          device_code: "冲击一室",
          status: "已结束",
        }),
      ],
    }));
  });

  test("rejects a planned maintenance end time that is not after its start time", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划维修";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T12:00";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T11:00";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanWarning).toBe("结束时间必须晚于开始时间");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test.each(["计划维修", "计划保养"])("rejects a past start time for %s", async (type) => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = type;
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T07:29";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanStartMin).toBe("2099-03-20T07:30");
    expect(wrapper.vm.maintenancePlanWarning).toBe("开始时间不得早于当前时间");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("keeps the end-time error when both planned times are invalid", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划维修";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T07:29";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T07:28";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanWarning).toBe("结束时间必须晚于开始时间");
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("allows editing an active plan when its past start time and type are unchanged", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [{
        code: "冲击一室",
        maintenance_note: "原备注",
        maintenance_start_at: "2099-03-20T07:00",
        maintenance_type: "计划保养",
        name: "冲击试验系统-1",
        status: "保养",
      }],
      "mes.experiment_runs": [],
      "mes.experiment_trays": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.note = "更新备注";

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanWarning).toBe("");
    expect(mocks.persistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      "mes.devices": [expect.objectContaining({
        maintenance_note: "更新备注",
        maintenance_start_at: "2099-03-20T07:00",
        maintenance_type: "计划保养",
      })],
    }));
  });

  test("clears a planned end time when the start time moves to or after it", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.type = "计划维修";
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T10:00";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-20T11:00";
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanEndMin).toBe("2099-03-20T10:01");

    wrapper.vm.maintenancePlanForm.startAt = "2099-03-20T11:00";
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanForm.endAt).toBe("");
  });

  test("keeps elapsed dates disabled for the maintenance end time before a start is selected", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);

    expect(wrapper.vm.maintenancePlanForm.startAt).toBe("");
    expect(wrapper.vm.maintenancePlanStartMin).toBe("2099-03-20T07:30");
    expect(wrapper.vm.maintenancePlanEndMin).toBe("2099-03-20T07:30");

    wrapper.vm.maintenancePlanForm.startAt = "2099-03-19T08:00";
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanEndMin).toBe("2099-03-20T07:30");
  });

  test.each(["维修", "保养"])("clears planned times for immediate %s and saves the confirmation time", async (type) => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [{ code: "冲击一室", name: "冲击试验系统-1", status: "可用" }],
      "mes.experiment_trays": [],
      "mes.experiment_runs": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
      "mes.maintenance_records": [],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openMaintenancePlan(wrapper.vm.deviceRows[0]);
    wrapper.vm.maintenancePlanForm.startAt = "2099-03-21T08:00";
    wrapper.vm.maintenancePlanForm.endAt = "2099-03-21T12:00";
    wrapper.vm.maintenancePlanForm.type = type;
    await settle(wrapper);

    expect(wrapper.vm.maintenancePlanIsPlanned).toBe(false);
    expect(wrapper.vm.maintenancePlanForm.startAt).toBe("");
    expect(wrapper.vm.maintenancePlanForm.endAt).toBe("");

    await wrapper.vm.saveMaintenancePlan();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      "mes.devices": [
        expect.objectContaining({
          maintenance_end_at: "",
          maintenance_start_at: "2099-03-20 07:30:00",
          maintenance_type: type,
          status: type,
        }),
      ],
    }));
  });

  test("cancels a future planned maintenance without an end time", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "",
          maintenance_note: "待确认",
          maintenance_start_at: "2099-03-21T08:00",
          maintenance_type: "计划维修",
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

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);

    expect(wrapper.vm.canSetDeviceAvailable).toBe(true);
    expect(wrapper.vm.deviceLifecycleActionLabel).toBe("取消计划");

    await wrapper.vm.setDeviceAvailable();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      "mes.devices": [
        expect.objectContaining({
          maintenance_end_at: "",
          maintenance_note: "",
          maintenance_start_at: "",
          maintenance_type: "",
          status: "可用",
        }),
      ],
    }));
  });

  test("cancels a future planned maintenance with an end time", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "2099-03-21T12:00",
          maintenance_note: "待确认",
          maintenance_start_at: "2099-03-21T08:00",
          maintenance_type: "计划保养",
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

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);

    expect(wrapper.vm.canSetDeviceAvailable).toBe(true);
    expect(wrapper.vm.deviceLifecycleActionLabel).toBe("取消计划");

    await wrapper.vm.setDeviceAvailable();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      "mes.devices": [
        expect.objectContaining({
          maintenance_end_at: "",
          maintenance_note: "",
          maintenance_start_at: "",
          maintenance_type: "",
          status: "可用",
        }),
      ],
    }));
  });

  test("keeps the early-end action available after an open edit dialog crosses the planned start time", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        {
          code: "冲击一室",
          maintenance_end_at: "",
          maintenance_start_at: "2099-03-20T08:00",
          maintenance_type: "计划维修",
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

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    await settle(wrapper);

    expect(wrapper.vm.canSetDeviceAvailable).toBe(true);

    await wrapper.vm.setDeviceAvailable();
    await settle(wrapper);

    expect(mocks.persistSnapshot).toHaveBeenCalled();
  });

  test("does not set a device available when the edit status is idle", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    wrapper.vm.openEditDevice(wrapper.vm.deviceRows[0]);
    await wrapper.vm.setDeviceAvailable();
    await settle(wrapper);

    expect(wrapper.vm.canSetDeviceAvailable).toBe(false);
    expect(mocks.persistSnapshot).not.toHaveBeenCalled();
  });

  test("sorts persisted maintenance records newest first and filters by device", async () => {
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.devices": [
        { code: "冲击一室", name: "冲击试验系统-1", status: "可用" },
        { code: "振动一室", name: "振动试验系统-1", status: "可用" },
      ],
      "mes.experiment_trays": [],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.conflicts": [],
      "mes.experiments": [],
      "mes.tasks": [],
      "mes.maintenance_records": [
        { device_code: "冲击一室", ended_at: "2099-03-19 09:00:00", id: "record-earlier" },
        { device_code: "振动一室", ended_at: "2099-03-20 09:00:00", id: "record-later" },
      ],
    });
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.maintenanceRecordRows.map((record) => record.id)).toEqual(["record-later", "record-earlier"]);

    wrapper.vm.maintenanceRecordDeviceFilter = "冲击一室";
    await settle(wrapper);

    expect(wrapper.vm.maintenanceRecordRows.map((record) => record.id)).toEqual(["record-earlier"]);
  });
});
