import { mount } from "@vue/test-utils";
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
});
