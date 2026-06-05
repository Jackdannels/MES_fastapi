import { enableAutoUnmount, mount } from "@vue/test-utils";
import { defineComponent, reactive, ref } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  readMasterTestTypes: vi.fn(),
  loadSnapshot: vi.fn(),
  persistSnapshot: vi.fn(),
  routerReplace: vi.fn(() => Promise.resolve()),
  routeState: {
    query: {
      highlightTask: "SYLU-2026-03-002",
    },
  },
}));

const reactiveRoute = reactive(mocks.routeState);

vi.mock("vue-router", () => ({
  useRoute: () => reactiveRoute,
  useRouter: () => ({
    replace: mocks.routerReplace,
  }),
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: mocks.loadSnapshot,
    persistSnapshot: mocks.persistSnapshot,
  }),
}));

vi.mock("@/lib/masterDataApi", () => ({
  readMasterTestTypes: mocks.readMasterTestTypes,
}));

vi.mock("./useTaskOverviewEditor", () => ({
  useTaskOverviewEditor: () => ({
    selectedTaskCode: ref(""),
    editingTaskCode: ref(""),
    savingTaskCode: ref(""),
    deletingTaskCode: ref(""),
    deleteConfirm: ref({}),
    editError: ref(""),
    editMessage: ref(""),
    editForm: ref({ sampleCodesText: "", sampleCount: 0, taskType: "" }),
    isEditing: () => false,
    openEdit: vi.fn(),
    cancelEdit: vi.fn(),
    resetDeleteConfirm: vi.fn(),
    handleCardClick: vi.fn(),
    handleCardDblClick: vi.fn(),
    handleGlobalClick: vi.fn(),
    generateCodesByCount: vi.fn(),
    saveEdit: vi.fn(),
    requestDeleteTask: vi.fn(),
    confirmDeleteTask: vi.fn(),
    updateEditForm: vi.fn(),
  }),
}));

import { useTaskOverview } from "./useTaskOverview";

enableAutoUnmount(afterEach);

const TestHarness = defineComponent({
  setup() {
    return useTaskOverview();
  },
  template: `
    <section ref="overviewRoot">
      <article class="task-overview-card" data-task-code="SYLU-2026-03-002"></article>
      <article class="task-overview-card" data-task-code="SYLU-2026-03-003"></article>
    </section>
  `,
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("useTaskOverview runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    reactiveRoute.query = { highlightTask: "SYLU-2026-03-002" };
    mocks.readMasterTestTypes.mockReset();
    mocks.loadSnapshot.mockResolvedValue({
      "mes.tasks": [
        {
          code: "SYLU-2026-03-002",
          sample_count: 3,
          status: "待排程",
          transfer_status: "已入库",
        },
      ],
      "mes.samples": [],
      "mes.schedules": [],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-03-002",
          experiment_code: "SYLU-2026-03-002-A",
          experiment_name: "盐雾试验",
          status: "待排程",
          unscheduled_since: "2026-03-10T08:00:00.000Z",
        },
      ],
    });
    mocks.readMasterTestTypes.mockResolvedValue([
      { code: "CUSTOM_FATIGUE", name: "自定义疲劳试验" },
    ]);
    mocks.persistSnapshot.mockReset();
    mocks.routerReplace.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    mocks.loadSnapshot.mockReset();
  });

  test("scrolls to the highlighted task card, flashes it, and clears the query without selecting the card", async () => {
    const scrollIntoView = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    const card = wrapper.find('[data-task-code="SYLU-2026-03-002"]');

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(card.classes()).toContain("is-highlighted");
    expect(wrapper.vm.selectedTaskCode).toBe("");
    expect(mocks.routerReplace).toHaveBeenCalledWith({
      query: {},
    });

    HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });

  test("uses master test types for readonly detail options even when current rows do not contain them", async () => {
    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(mocks.readMasterTestTypes).toHaveBeenCalledTimes(1);
    expect(wrapper.vm.taskTypeEditOptions).toEqual(expect.arrayContaining(["自定义疲劳试验"]));
  });

  test("reloads overview data when sample updates are broadcast", async () => {
    mocks.loadSnapshot
      .mockResolvedValueOnce({
        "mes.tasks": [
          {
            code: "SYLU-2026-03-002",
            sample_count: 3,
            status: "待排程",
            transfer_status: "到货",
          },
        ],
        "mes.samples": [],
        "mes.schedules": [],
        "mes.experiments": [
          {
            task_code: "SYLU-2026-03-002",
            experiment_code: "SYLU-2026-03-002-A",
            experiment_name: "盐雾试验",
            status: "待排程",
          },
        ],
      })
      .mockResolvedValueOnce({
        "mes.tasks": [
          {
            code: "SYLU-2026-03-003",
            sample_count: 1,
            status: "已排程",
            transfer_status: "到货",
          },
        ],
        "mes.samples": [],
        "mes.schedules": [
          {
            task_code: "SYLU-2026-03-003",
            experiment_code: "SYLU-2026-03-003-A",
            start_at: "2026-03-11T08:00:00.000Z",
          },
        ],
        "mes.experiments": [
          {
            task_code: "SYLU-2026-03-003",
            experiment_code: "SYLU-2026-03-003-A",
            experiment_name: "振动试验",
            status: "已排程",
          },
        ],
      });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    window.dispatchEvent(new CustomEvent("mes:samples-updated"));
    await settle(wrapper);

    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.filteredRows.map((row) => row.taskCode)).toEqual(["SYLU-2026-03-003"]);
  });

  test("reloads overview data when storage snapshot updates are broadcast", async () => {
    mocks.loadSnapshot
      .mockResolvedValueOnce({
        "mes.tasks": [
          {
            code: "SYLU-2026-03-002",
            sample_count: 3,
            status: "待排程",
            transfer_status: "到货",
          },
        ],
        "mes.samples": [],
        "mes.schedules": [],
        "mes.experiments": [
          {
            task_code: "SYLU-2026-03-002",
            experiment_code: "SYLU-2026-03-002-A",
            experiment_name: "盐雾试验",
            status: "待排程",
          },
        ],
      })
      .mockResolvedValueOnce({
        "mes.tasks": [
          {
            code: "SYLU-2026-03-004",
            sample_count: 1,
            status: "已排程",
            transfer_status: "到货",
          },
        ],
        "mes.samples": [],
        "mes.schedules": [],
        "mes.experiments": [
          {
            task_code: "SYLU-2026-03-004",
            experiment_code: "SYLU-2026-03-004-A",
            experiment_name: "振动试验",
            status: "实验进行中",
          },
        ],
      });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    window.dispatchEvent(new CustomEvent("mes:snapshot-updated", { detail: { keys: ["mes.experiments"] } }));
    await settle(wrapper);

    expect(mocks.loadSnapshot).toHaveBeenCalledTimes(2);
    expect(wrapper.vm.filteredRows.map((row) => row.taskCode)).toEqual(["SYLU-2026-03-004"]);
  });

  test("uses experiment run state for tray overview flows when tray status is still ready", async () => {
    reactiveRoute.query = {};
    mocks.loadSnapshot.mockResolvedValueOnce({
      "mes.tasks": [
        {
          code: "SYLU-2026-06-021",
          sample_count: 1,
          status: "任务进行中",
          test_type: "振动试验 / 冲击试验 / 温度冲击试验",
          transfer_status: "到货",
        },
      ],
      "mes.samples": [
        {
          code: "SYLU-2026-06-021-SP-001",
          task_code: "SYLU-2026-06-021",
          location: "冲击一室",
          status: "实验准备就绪",
          trays: [
            {
              tray_code: "SYLU-2026-06-021-TP-001",
              status: "实验准备就绪",
            },
          ],
        },
      ],
      "mes.schedules": [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "EXP-VIBRATION",
          device: "振动一室",
          start_at: "2026-06-04T08:00:00.000Z",
          status: "实验已完成",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "EXP-IMPACT",
          device: "冲击一室",
          start_at: "2026-06-04T10:00:00.000Z",
          status: "实验准备就绪",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "EXP-TEMP-SHOCK",
          device: "温度冲击一室",
          start_at: "2026-06-04T12:00:00.000Z",
          status: "已排程",
        },
      ],
      "mes.experiments": [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "EXP-VIBRATION",
          experiment_name: "振动试验",
          required_device: "振动试验",
          status: "实验已完成",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "EXP-IMPACT",
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          status: "实验准备就绪",
        },
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "EXP-TEMP-SHOCK",
          experiment_name: "温度冲击试验",
          required_device: "温度冲击试验",
          status: "已排程",
        },
      ],
      "mes.experiment_trays": [
        { task_code: "SYLU-2026-06-021", experiment_code: "EXP-VIBRATION", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "EXP-IMPACT", tray_code: "SYLU-2026-06-021-TP-001" },
        { task_code: "SYLU-2026-06-021", experiment_code: "EXP-TEMP-SHOCK", tray_code: "SYLU-2026-06-021-TP-001" },
      ],
      "mes.experiment_runs": [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "EXP-IMPACT",
          tray_codes: ["SYLU-2026-06-021-TP-001"],
          status: "实验进行中",
          updated_at: "2026-06-04T10:30:00.000Z",
        },
      ],
    });

    const wrapper = mount(TestHarness);
    await settle(wrapper);

    expect(wrapper.vm.trayOverviewRows[0]).toMatchObject({
      trayCode: "SYLU-2026-06-021-TP-001",
      currentStatus: "冲击试验进行中",
    });
  });

});
