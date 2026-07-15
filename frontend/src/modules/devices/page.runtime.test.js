import { mount } from "@vue/test-utils";
import { computed, reactive, ref } from "vue";
import { beforeEach, describe, expect, test, vi } from "vitest";

import DevicesPage from "./page.vue";

const saveCurrentDeviceMock = vi.fn();
const createNewDeviceMock = vi.fn();
const openDeviceDrawerMock = vi.fn();
const openEditDeviceMock = vi.fn();
const closeEditDeviceMock = vi.fn();
const openMaintenancePlanMock = vi.fn();
const closeMaintenancePlanMock = vi.fn();
const saveEditedDeviceMock = vi.fn();
const saveMaintenancePlanMock = vi.fn();
const setDeviceAvailableMock = vi.fn();
const cancelMaintenanceConflictMock = vi.fn();
const confirmMaintenanceConflictMock = vi.fn();
const closeRunningRepairChoiceMock = vi.fn();
const confirmRunningRepairCompleteMock = vi.fn();
const confirmRunningRepairRescheduleMock = vi.fn();
const closeDeviceDrawerMock = vi.fn();
const openPointModalMock = vi.fn();
const closePointModalMock = vi.fn();
const savePointMock = vi.fn();

const devicesState = reactive({
  canSetDeviceAvailable: false,
  deviceDrawerOpen: false,
  editDeviceOpen: false,
  maintenanceConflictOpen: false,
  maintenancePlanWarning: "",
  maintenancePlanOpen: false,
  pointModalOpen: false,
  runningRepairChoiceOpen: false,
});

vi.mock("./useDevicesPage", () => ({
  useDevicesPage: () => ({
    cancelMaintenanceConflict: cancelMaintenanceConflictMock,
    closeRunningRepairChoice: closeRunningRepairChoiceMock,
    closeDeviceDrawer: closeDeviceDrawerMock,
    closeEditDevice: closeEditDeviceMock,
    closeMaintenancePlan: closeMaintenancePlanMock,
    closePointModal: closePointModalMock,
    confirmMaintenanceConflict: confirmMaintenanceConflictMock,
    confirmRunningRepairComplete: confirmRunningRepairCompleteMock,
    confirmRunningRepairReschedule: confirmRunningRepairRescheduleMock,
    connectionForm: ref({
      endpoint: "10.10.0.23",
      functionCode: "03 读保持寄存器",
      parity: "CRC",
      pollingInterval: "1s",
      port: "502",
      protocol: "TCP",
      retryPolicy: "3s / 2次",
      stationId: "1",
    }),
    createNewDevice: createNewDeviceMock,
    canSetDeviceAvailable: computed(() => devicesState.canSetDeviceAvailable),
    deviceDrawerOpen: computed(() => devicesState.deviceDrawerOpen),
    deviceForm: ref({
      acquisition_enabled: "启用",
      code: "HPLC-01",
      location: "液相实验室",
      model: "1260",
      name: "高效液相色谱仪",
      owner: "张工",
      status: "空闲",
      type: "液相色谱",
    }),
    deviceRows: computed(() => [
      {
        code: "HPLC-01",
        id: "device-1",
        location: "液相实验室",
        maintenancePlanEndAt: "2026-04-01 12:00",
        name: "高效液相色谱仪",
        nextMaintenanceAt: "2026-04-01 08:00",
        status: "空闲",
        statusClass: "status",
        type: "液相色谱",
      },
    ]),
    editDeviceOpen: computed(() => devicesState.editDeviceOpen),
    editDeviceStatusClass: computed(() => "status"),
    locationOptions: computed(() => ["液相实验室", "微生物实验室"]),
    maintenanceConflictDetail: ref({
      conflictingSchedules: [],
    }),
    maintenanceConflictOpen: computed(() => devicesState.maintenanceConflictOpen),
    maintenanceRecordDeviceFilter: ref(""),
    maintenanceRecordRows: computed(() => [
      {
        device_code: "HPLC-01",
        device_name: "高效液相色谱仪",
        ended_at: "2026-04-01 12:00",
        maintenance_note: "年度保养",
        maintenance_type: "保养",
        started_at: "2026-04-01 08:00",
        status: "已结束",
      },
    ]),
    maintenancePlanForm: ref({
      endAt: "",
      note: "",
      startAt: "",
      type: "计划维修",
    }),
    maintenancePlanIsPlanned: computed(() => true),
    maintenancePlanWarning: computed(() => devicesState.maintenancePlanWarning),
    maintenancePlanOpen: computed(() => devicesState.maintenancePlanOpen),
    metrics: computed(() => ({
      activeCount: 1,
      idleCount: 3,
      maintenanceCount: 1,
    })),
    openEditDevice: openEditDeviceMock,
    openDeviceDrawer: openDeviceDrawerMock,
    openMaintenancePlan: openMaintenancePlanMock,
    openPointModal: openPointModalMock,
    pointForm: ref({
      address: "",
      dataType: "INT16",
      frequency: "1s",
      name: "",
      note: "",
      ratio: "1",
      unit: "",
    }),
    pointModalOpen: computed(() => devicesState.pointModalOpen),
    pointRows: computed(() => [
      {
        address: "40001",
        dataType: "INT16",
        frequency: "1s",
        id: "point-1",
        name: "温度",
        note: "反应腔温度",
        ratio: "0.1",
        unit: "°C",
      },
    ]),
    query: ref(""),
    runningRepairChoiceDetail: ref({
      runningSchedules: [{ experiment_code: "TASK-001-A", id: "schedule-1", task_code: "TASK-001" }],
    }),
    runningRepairChoiceOpen: computed(() => devicesState.runningRepairChoiceOpen),
    saveCurrentDevice: saveCurrentDeviceMock,
    saveEditedDevice: saveEditedDeviceMock,
    saveMaintenancePlan: saveMaintenancePlanMock,
    savePoint: savePointMock,
    selectedDevice: computed(() => ({
      code: "HPLC-01",
      name: "高效液相色谱仪",
    })),
    setDeviceAvailable: setDeviceAvailableMock,
    testTypeOptions: computed(() => ["液相色谱", "微生物"]),
    toggleSort: vi.fn(),
  }),
}));

describe("DevicesPage runtime", () => {
  beforeEach(() => {
    devicesState.canSetDeviceAvailable = false;
    devicesState.deviceDrawerOpen = false;
    devicesState.editDeviceOpen = false;
    devicesState.maintenanceConflictOpen = false;
    devicesState.maintenancePlanWarning = "";
    devicesState.maintenancePlanOpen = false;
    devicesState.pointModalOpen = false;
    devicesState.runningRepairChoiceOpen = false;
  });

  test("renders device rows and hides ledger mutation actions", async () => {
    const wrapper = mount(DevicesPage);

    expect(wrapper.text()).toContain("HPLC-01");
    expect(wrapper.text()).toContain("高效液相色谱仪");
    expect(wrapper.text()).toContain("下次维保");
    expect(wrapper.text()).toContain("维保计划结束时间");
    expect(wrapper.text()).toContain("2026-04-01 08:00");
    expect(wrapper.text()).toContain("2026-04-01 12:00");
    expect(wrapper.text()).not.toContain("下次校准");
    expect(wrapper.find('[data-testid="device-save"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="device-add"]').exists()).toBe(false);
  });

  test("opens the central maintenance records modal and point modal from Vue state", async () => {
    const wrapper = mount(DevicesPage);

    await wrapper.get('[data-testid="open-device-drawer"]').trigger("click");
    await wrapper.get('[data-testid="open-point-modal"]').trigger("click");

    expect(openDeviceDrawerMock).toHaveBeenCalledTimes(1);
    expect(openPointModalMock).toHaveBeenCalledTimes(1);

    devicesState.deviceDrawerOpen = true;
    devicesState.pointModalOpen = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".drawer.is-open").exists()).toBe(false);
    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
  });

  test("renders real maintenance records in the central modal", () => {
    devicesState.deviceDrawerOpen = true;
    const wrapper = mount(DevicesPage);

    expect(wrapper.text()).toContain("设备维保记录");
    expect(wrapper.text()).toContain("高效液相色谱仪");
    expect(wrapper.text()).toContain("年度保养");
    expect(wrapper.find(".app-drawer").exists()).toBe(false);
  });

  test("replaces table details action with edit and maintenance plan actions", async () => {
    const wrapper = mount(DevicesPage);

    expect(wrapper.text()).not.toContain("详情");

    await wrapper.get('[data-testid="open-device-edit-0"]').trigger("click");
    const maintenanceButton = wrapper.get('[data-testid="open-maintenance-plan-0"]');
    expect(maintenanceButton.classes()).toContain("devices-action-link--maintenance");

    await maintenanceButton.trigger("click");

    expect(openEditDeviceMock).toHaveBeenCalledTimes(1);
    expect(openMaintenancePlanMock).toHaveBeenCalledTimes(1);
  });

  test("renders maintenance plan type options and action order", async () => {
    const wrapper = mount(DevicesPage);

    devicesState.maintenancePlanOpen = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('select[name="maintenance_type"] option').map((option) => option.text())).toEqual([
      "计划维修",
      "维修",
      "计划保养",
      "保养",
    ]);
    const footerButtons = wrapper.findAll(".modal.is-open .form-actions button").map((button) => button.text());
    expect(footerButtons).toEqual(["取消", "确定"]);

    devicesState.maintenancePlanOpen = false;
  });

  test("renders maintenance plan warning text", async () => {
    const wrapper = mount(DevicesPage);

    devicesState.maintenancePlanOpen = true;
    await wrapper.vm.$nextTick();

    devicesState.maintenancePlanWarning = "请选择开始时间";
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="maintenance-plan-warning"]').text()).toBe("请选择开始时间");
  });

  test("renders edit status as non-selectable display and disables set available for idle status", async () => {
    const wrapper = mount(DevicesPage);

    devicesState.editDeviceOpen = true;
    await wrapper.vm.$nextTick();

    const statusDisplay = wrapper.get('[data-testid="device-edit-status"]');
    expect(statusDisplay.element.tagName).toBe("DIV");
    expect(wrapper.find('input[name="edit_status"]').exists()).toBe(false);
    expect(statusDisplay.classes()).toContain("status");
    expect(statusDisplay.element.closest(".form-field")?.querySelector('[data-testid="device-set-available"]')).toBeTruthy();
    expect(wrapper.get('[data-testid="device-set-available"]').attributes("disabled")).toBeDefined();
    const footerButtons = wrapper.findAll(".modal.is-open .form-actions button").map((button) => button.text());
    expect(footerButtons).toEqual(["取消", "确定"]);

    await wrapper.get('[data-testid="device-set-available"]').trigger("click");
    expect(setDeviceAvailableMock).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="device-edit-confirm"]').trigger("click");
    expect(saveEditedDeviceMock).toHaveBeenCalledTimes(1);

    devicesState.editDeviceOpen = false;
  });

  test("enables set available when edit status is unavailable", async () => {
    devicesState.canSetDeviceAvailable = true;
    const wrapper = mount(DevicesPage);

    devicesState.editDeviceOpen = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.get('[data-testid="device-set-available"]').attributes("disabled")).toBeUndefined();
    await wrapper.get('[data-testid="device-set-available"]').trigger("click");

    expect(setDeviceAvailableMock).toHaveBeenCalledTimes(1);
  });

  test("renders running repair choice actions", async () => {
    const wrapper = mount(DevicesPage);

    devicesState.runningRepairChoiceOpen = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.find('[data-testid="running-repair-choice-modal"]').exists()).toBe(true);
    await wrapper.get('[data-testid="running-repair-reschedule"]').trigger("click");
    await wrapper.get('[data-testid="running-repair-complete"]').trigger("click");

    expect(confirmRunningRepairRescheduleMock).toHaveBeenCalledTimes(1);
    expect(confirmRunningRepairCompleteMock).toHaveBeenCalledTimes(1);
  });
});
