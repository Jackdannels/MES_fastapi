import { mount } from "@vue/test-utils";
import { computed, reactive, ref } from "vue";
import { describe, expect, test, vi } from "vitest";

import DevicesPage from "./page.vue";

const saveCurrentDeviceMock = vi.fn();
const createNewDeviceMock = vi.fn();
const openDeviceDrawerMock = vi.fn();
const closeDeviceDrawerMock = vi.fn();
const openPointModalMock = vi.fn();
const closePointModalMock = vi.fn();
const savePointMock = vi.fn();

const devicesState = reactive({
  deviceDrawerOpen: false,
  pointModalOpen: false,
});

vi.mock("./useDevicesPage", () => ({
  useDevicesPage: () => ({
    closeDeviceDrawer: closeDeviceDrawerMock,
    closePointModal: closePointModalMock,
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
    deviceDrawerOpen: computed(() => devicesState.deviceDrawerOpen),
    deviceForm: ref({
      acquisition_enabled: "启用",
      code: "HPLC-01",
      location: "液相实验室",
      model: "1260",
      name: "高效液相色谱仪",
      next_cal: "2026-04-01",
      owner: "张工",
      status: "可用",
      type: "液相色谱",
    }),
    deviceRows: computed(() => [
      {
        code: "HPLC-01",
        id: "device-1",
        location: "液相实验室",
        name: "高效液相色谱仪",
        nextCal: "2026-04-01",
        status: "可用",
        statusClass: "status",
        type: "液相色谱",
      },
    ]),
    locationOptions: computed(() => ["液相实验室", "微生物实验室"]),
    maintenanceForm: ref({
      latestCalibration: "2026-03-01",
      maintenanceType: "校准",
      record: "年度校准完成",
    }),
    metrics: computed(() => ({
      activeCount: 1,
      idleCount: 3,
      maintenanceCount: 1,
    })),
    openDeviceDrawer: openDeviceDrawerMock,
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
    saveCurrentDevice: saveCurrentDeviceMock,
    savePoint: savePointMock,
    selectedDevice: computed(() => ({
      code: "HPLC-01",
      name: "高效液相色谱仪",
    })),
    testTypeOptions: computed(() => ["液相色谱", "微生物"]),
    toggleSort: vi.fn(),
  }),
}));

describe("DevicesPage runtime", () => {
  test("renders device rows and delegates device save action", async () => {
    const wrapper = mount(DevicesPage);

    expect(wrapper.text()).toContain("HPLC-01");
    expect(wrapper.text()).toContain("高效液相色谱仪");

    await wrapper.get('[data-testid="device-save"]').trigger("click");

    expect(saveCurrentDeviceMock).toHaveBeenCalledTimes(1);
  });

  test("opens maintenance drawer and point modal from Vue state", async () => {
    const wrapper = mount(DevicesPage);

    await wrapper.get('[data-testid="open-device-drawer"]').trigger("click");
    await wrapper.get('[data-testid="open-point-modal"]').trigger("click");

    expect(openDeviceDrawerMock).toHaveBeenCalledTimes(1);
    expect(openPointModalMock).toHaveBeenCalledTimes(1);

    devicesState.deviceDrawerOpen = true;
    devicesState.pointModalOpen = true;
    await wrapper.vm.$nextTick();

    expect(wrapper.find(".drawer.is-open").exists()).toBe(true);
    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
  });

  test("renders reactive test-type and lab options without legacy DOM patching", () => {
    const wrapper = mount(DevicesPage);

    expect(wrapper.findAll('select[name="type"] option').length).toBeGreaterThan(1);
    expect(wrapper.findAll('select[name="location"] option').length).toBeGreaterThan(1);
  });
});
