import { flushPromises, mount } from "@vue/test-utils";
import { reactive } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { buildApiUrl, getFrontendApiBaseUrl } from "../../lib/apiBase.js";
import { TEST_PREFIX_MAP } from "../../lib/labs.js";
import TasksPage from "./page.vue";

const SCHEDULES_KEY = "mes.schedules";
const SAMPLES_KEY = "mes.samples";
const STREAMS_KEY = "mes.streams";
const EXPERIMENTS_KEY = "mes.experiments";
const EXPERIMENT_TRAYS_KEY = "mes.experiment_trays";
const EXPERIMENT_SAMPLES_KEY = "mes.experiment_samples";
const EXTERNAL_INTAKES_KEY = "mes.external_task_intakes";
const TASKS_ENDPOINT = buildApiUrl("/api/tasks", getFrontendApiBaseUrl());
const TASKS_RESET_ENDPOINT = buildApiUrl("/api/tasks/reset", getFrontendApiBaseUrl());
const STORAGE_ENDPOINT = buildApiUrl("/api/storage", getFrontendApiBaseUrl());
const isStorageGetUrl = (url) => url === STORAGE_ENDPOINT || url.startsWith(`${STORAGE_ENDPOINT}?`);
const MASTER_TEST_TYPES_ENDPOINT = buildApiUrl("/api/master/test-types", getFrontendApiBaseUrl());
const buildTaskEndpoint = (taskId) => buildApiUrl(`/api/tasks/${taskId}`, getFrontendApiBaseUrl());
const buildCurrentMonthFirstTaskCode = () =>
  `SYLU-${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-001`;
const ALL_EXPERIMENT_TYPES = Object.keys(TEST_PREFIX_MAP);
const DEFAULT_AXIS_CODES = ["x+", "x-", "y+", "y-", "z+", "z-"];

const routeState = reactive({ hash: "" });

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
}));

const clone = (value) => JSON.parse(JSON.stringify(value));
const isReturnedTask = (task, samples = []) => {
  const taskCode = String(task?.code ?? task?.task_code ?? task?.id ?? "").trim();
  const trayStatuses = samples
    .filter((sample) => String(sample?.task_code ?? "").trim() === taskCode)
    .flatMap((sample) =>
      (Array.isArray(sample?.trays) ? sample.trays : []).map((tray) =>
        String(tray?.status ?? sample?.status ?? sample?.flow_status ?? "").trim(),
      ),
    )
    .filter(Boolean);
  if (trayStatuses.length > 0) {
    return trayStatuses.every((status) => status === "厂家收回");
  }
  return ["transfer_status", "transferStatus", "status", "displayStatus", "display_status"].some(
    (key) => String(task?.[key] ?? "").trim() === "厂家收回",
  );
};

const createTask = (overrides = {}) => ({
  id: "task-1",
  code: "SYLU-2026-03-001",
  name: "冲击试验-批次A",
  source: "外部委托",
  priority: "高",
  sample_count: 12,
  sample_type: "结构件",
  test_type: "冲击试验",
  required_device: "冲击试验",
  due_at: "2026-03-13 18:00",
  arrival_at: "2026-03-13 12:00",
  status: "待排程",
  created_at: "2026-03-13T08:00:00.000Z",
  ...overrides,
});

const buildMockTaskExperiments = (task, existingExperiments = []) => {
  const taskCode = String(task?.code ?? task?.id ?? "").trim();
  const testTypes = Array.isArray(task?.test_types)
    ? task.test_types.map((item) => String(item ?? "").trim()).filter(Boolean)
    : String(task?.test_type ?? "")
      .split("/")
      .map((item) => item.trim())
      .filter(Boolean);
  const desiredCount = testTypes.length || 1;
  const existingCodes = existingExperiments
    .map((experiment) => String(experiment?.experiment_code ?? "").trim())
    .filter(Boolean);
  const payloadCodes = Array.isArray(task?.experiment_codes)
    ? task.experiment_codes.map((code) => String(code ?? "").trim()).filter(Boolean)
    : [];
  const seedCodes = payloadCodes.length > 0 ? payloadCodes : existingCodes;
  const codes = [];
  seedCodes.forEach((code) => {
    if (code && !codes.includes(code) && codes.length < desiredCount) {
      codes.push(code);
    }
  });
  while (codes.length < desiredCount) {
    codes.push(`${taskCode}-${String.fromCharCode(65 + codes.length)}`);
  }
  const axisCodesByTestType = task?.axis_codes_by_test_type || task?.axisCodesByTestType || {};
  return codes.slice(0, desiredCount).map((experimentCode, index) => ({
    id: experimentCode,
    task_code: taskCode,
    experiment_code: experimentCode,
    experiment_name: testTypes[index] ?? `实验${index + 1}`,
    required_device: testTypes[index] ?? `实验${index + 1}`,
    status: task?.status ?? "待排程",
    ...(Array.isArray(axisCodesByTestType[testTypes[index]]) && axisCodesByTestType[testTypes[index]].length > 0
      ? { axis_codes: [...axisCodesByTestType[testTypes[index]]] }
      : {}),
  }));
};

const createTasksPageFetchMock = ({
  tasks = [],
  schedules = [],
  samples = [],
  streams = [],
  experiments = [],
  experimentTrays = [],
  experimentSamples = [],
  externalTaskIntakes = [],
  testTypes = ALL_EXPERIMENT_TYPES.map((name) => ({ name })),
  testTypesError = null,
  afterReset = null,
  resetError = null,
} = {}) => {
  const state = {
    tasks: clone(tasks),
    schedules: clone(schedules),
    samples: clone(samples),
    streams: clone(streams),
    experiments: clone(experiments),
    experimentTrays: clone(experimentTrays),
    experimentSamples: clone(experimentSamples),
    externalTaskIntakes: clone(externalTaskIntakes),
  };

  const fetchMock = vi.fn((url, options = {}) => {
    const method = options.method ?? "GET";

    if ((url === TASKS_ENDPOINT || url === `${TASKS_ENDPOINT}?includeArchived=true`) && method === "GET") {
      const tasks = url.includes("includeArchived=true")
        ? state.tasks
        : state.tasks.filter((task) => !isReturnedTask(task, state.samples));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => clone(tasks),
      });
    }

    if (url === TASKS_ENDPOINT && method === "POST") {
      const nextTask = JSON.parse(options.body ?? "{}");
      state.tasks = [nextTask, ...state.tasks];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => clone(nextTask),
      });
    }

    if (url === TASKS_RESET_ENDPOINT && method === "POST") {
      if (resetError) {
        return Promise.resolve({
          ok: false,
          status: resetError.status ?? 500,
          statusText: resetError.statusText ?? "Reset Failed",
        });
      }
      if (afterReset) {
        state.tasks = clone(afterReset.tasks ?? []);
        state.schedules = clone(afterReset.schedules ?? []);
        state.samples = clone(afterReset.samples ?? []);
        state.streams = clone(afterReset.streams ?? []);
        state.experiments = clone(afterReset.experiments ?? []);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          task_count: state.tasks.length,
          sample_count: state.samples.length,
          experiment_count: state.experiments.length,
        }),
      });
    }

    if (url.includes("/api/tasks/external-intakes/") && url.endsWith("/accept") && method === "POST") {
      const intakeId = decodeURIComponent(url.split("/external-intakes/")[1].replace("/accept", ""));
      const intake = state.externalTaskIntakes.find((item) => (item.intake_id || item.id) === intakeId);
      if (!intake) {
        return Promise.resolve({ ok: false, status: 404, statusText: "Not Found", json: async () => ({ detail: "外部委托不存在" }) });
      }
      const nextTask = { ...clone(intake), id: intake.code, source: "外部委托", status: "待排程", arrival_at: "" };
      delete nextTask.acceptance_status;
      state.tasks = [nextTask, ...state.tasks];
      state.externalTaskIntakes = state.externalTaskIntakes.map((item) => (
        item === intake ? { ...item, acceptance_status: "accepted" } : item
      ));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ intake: { ...intake, acceptance_status: "accepted" }, task: nextTask }),
      });
    }

    if (url.startsWith(buildTaskEndpoint("")) && method === "PUT") {
      const taskId = url.slice(buildTaskEndpoint("").length);
      const nextTask = JSON.parse(options.body ?? "{}");
      const previousTask = state.tasks.find((task) => task.id === taskId);
      const previousTaskCode = String(previousTask?.code ?? "").trim();
      const nextTaskCode = String(nextTask?.code ?? previousTaskCode).trim();
      const existingTaskExperiments = state.experiments.filter(
        (experiment) => String(experiment?.task_code ?? "").trim() === previousTaskCode,
      );
      state.tasks = state.tasks.map((task) => (task.id === taskId ? clone(nextTask) : task));
      state.experiments = [
        ...state.experiments.filter((experiment) => String(experiment?.task_code ?? "").trim() !== previousTaskCode),
        ...buildMockTaskExperiments({ ...nextTask, code: nextTaskCode }, existingTaskExperiments),
      ];
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => clone(nextTask),
      });
    }

    if (url.startsWith(buildTaskEndpoint("")) && method === "DELETE") {
      const taskId = url.slice(buildTaskEndpoint("").length);
      state.tasks = state.tasks.filter((task) => task.id !== taskId);
      return Promise.resolve({
        ok: true,
        status: 204,
      });
    }

    if (isStorageGetUrl(url) && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          [SCHEDULES_KEY]: clone(state.schedules),
          [SAMPLES_KEY]: clone(state.samples),
          [STREAMS_KEY]: clone(state.streams),
          [EXPERIMENTS_KEY]: clone(state.experiments),
          [EXPERIMENT_TRAYS_KEY]: clone(state.experimentTrays),
          [EXPERIMENT_SAMPLES_KEY]: clone(state.experimentSamples),
          [EXTERNAL_INTAKES_KEY]: clone(state.externalTaskIntakes),
        }),
      });
    }

    if (url === MASTER_TEST_TYPES_ENDPOINT && method === "GET") {
      if (testTypesError) {
        return Promise.resolve({
          ok: false,
          status: testTypesError.status ?? 500,
          statusText: testTypesError.statusText ?? "Master Data Failed",
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => clone(testTypes),
      });
    }

    if (url === STORAGE_ENDPOINT && method === "PUT") {
      const updates = JSON.parse(options.body ?? "{}");
      if (Array.isArray(updates[SCHEDULES_KEY])) {
        state.schedules = clone(updates[SCHEDULES_KEY]);
      }
      if (Array.isArray(updates[SAMPLES_KEY])) {
        state.samples = clone(updates[SAMPLES_KEY]);
      }
      if (Array.isArray(updates[STREAMS_KEY])) {
        state.streams = clone(updates[STREAMS_KEY]);
      }
      if (Array.isArray(updates[EXPERIMENTS_KEY])) {
        state.experiments = clone(updates[EXPERIMENTS_KEY]);
      }
      if (Array.isArray(updates[EXPERIMENT_TRAYS_KEY])) {
        state.experimentTrays = clone(updates[EXPERIMENT_TRAYS_KEY]);
      }
      if (Array.isArray(updates[EXPERIMENT_SAMPLES_KEY])) {
        state.experimentSamples = clone(updates[EXPERIMENT_SAMPLES_KEY]);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
    }

    return Promise.reject(new Error(`unexpected request: ${method} ${url}`));
  });

  return { fetchMock, state };
};

const installApiFetchMock = (config = {}) => {
  const api = createTasksPageFetchMock(config);
  vi.stubGlobal("fetch", api.fetchMock);
  return api;
};

const settle = async (wrapper) => {
  await flushPromises();
  await wrapper.vm.$nextTick();
  await flushPromises();
  await wrapper.vm.$nextTick();
};

const selectIntakeAxisExperiment = async (wrapper, experimentType, axisCodes = DEFAULT_AXIS_CODES) => {
  await wrapper.get(`[data-testid="task-intake-test-type-option-${experimentType}"]`).trigger("click");
  await settle(wrapper);
  expect(wrapper.get('[data-testid="task-intake-axis-modal"]').exists()).toBe(true);
  const selectedCodes = new Set(axisCodes);
  for (const axisCode of DEFAULT_AXIS_CODES) {
    if (!selectedCodes.has(axisCode)) {
      await wrapper.get(`[data-testid="task-intake-axis-option-${axisCode}"]`).trigger("click");
    }
  }
  await wrapper.get('[data-testid="task-intake-axis-confirm"]').trigger("click");
  await settle(wrapper);
};

const selectEditAxisExperiment = async (wrapper, experimentType, axisCodes = DEFAULT_AXIS_CODES) => {
  await wrapper.get(`[data-testid="task-edit-test-type-option-${experimentType}"]`).trigger("click");
  await settle(wrapper);
  expect(wrapper.get('[data-testid="task-edit-axis-modal"]').exists()).toBe(true);
  const selectedCodes = new Set(axisCodes);
  for (const axisCode of DEFAULT_AXIS_CODES) {
    const option = wrapper.get(`[data-testid="task-edit-axis-option-${axisCode}"]`);
    const isSelected = option.classes().includes("is-selected");
    if (selectedCodes.has(axisCode) !== isSelected) {
      await option.trigger("click");
    }
  }
  await wrapper.get('[data-testid="task-edit-axis-confirm"]').trigger("click");
  await settle(wrapper);
};

const removeEditAxisExperiment = async (wrapper, experimentType) => {
  await wrapper.get(`[data-testid="task-edit-test-type-option-${experimentType}"]`).trigger("click");
  await settle(wrapper);
  expect(wrapper.get('[data-testid="task-edit-axis-modal"]').exists()).toBe(true);
  await wrapper.get('[data-testid="task-edit-axis-remove"]').trigger("click");
  await settle(wrapper);
};

describe("TasksPage runtime", () => {
  beforeEach(() => {
    const store = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem(key) {
          return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
          store.set(key, String(value));
        },
        removeItem(key) {
          store.delete(key);
        },
        clear() {
          store.clear();
        },
      },
    });
    window.location.hash = "";
    routeState.hash = "";
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    window.location.hash = "";
    routeState.hash = "";
  });

  test("shows an explicit load error when task data cannot be fetched", async () => {
    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("任务数据加载失败");
    expect(wrapper.findAll("#task-table tbody tr")).toHaveLength(0);
  });

  test("renders task rows, filters visible tasks, and opens the centered task detail modal from API data", async () => {
    installApiFetchMock({
      tasks: [
        createTask(),
        createTask({
          id: "task-2",
          code: "SYLU-2026-03-002",
          name: "霉菌试验",
          source: "内部新增",
          priority: "中",
          sample_count: 4,
          sample_type: "粉末",
          test_type: "霉菌试验",
          required_device: "霉菌试验",
          due_at: "2026-03-14 10:00",
          arrival_at: "2026-03-13 09:00",
          created_at: "2026-03-13T09:00:00.000Z",
        }),
      ],
      experiments: [
        {
          id: "SYLU-2026-03-001-A",
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          experiment_name: "冲击试验",
          required_device: "冲击试验",
          axis_codes: ["z-", "x+"],
          status: "待排程",
        },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-001");
    expect(wrapper.get("#task-unscheduled-count").text()).toBe("2");
    expect(wrapper.findAll("#task-table tbody tr")).toHaveLength(2);
    expect(wrapper.findAll(".tasks-table__cell--status .status.waiting")).toHaveLength(2);

    await wrapper.get('input[placeholder="筛选任务编号/实验摘要/样品编号"]').setValue("SYLU-2026-03-001");

    expect(wrapper.findAll("#task-table tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("SYLU-2026-03-001");

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");

    expect(wrapper.find(".drawer.is-open").exists()).toBe(false);
    expect(wrapper.find('[data-testid="task-detail-modal"].modal.is-open').exists()).toBe(true);
    expect(wrapper.text()).toContain("任务详情");
    expect(wrapper.get('[data-testid="task-edit-test-types-trigger"]').text()).toContain("冲击试验（X+、Z-）");

    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");

    expect(wrapper.get('[data-testid="task-edit-test-types-summary"]').text()).toContain("冲击试验（X+、Z-）");

    await wrapper.get('[data-testid="task-edit-test-type-option-冲击试验"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="task-edit-axis-modal"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="task-edit-axis-type"]').text()).toBe("冲击试验");
    expect(wrapper.get('[data-testid="task-edit-axis-option-z-"]').classes()).toContain("is-selected");
    expect(wrapper.get('[data-testid="task-edit-axis-option-x+"]').classes()).toContain("is-selected");
    await wrapper.get('[data-testid="task-edit-axis-option-z-"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-axis-option-y+"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-axis-confirm"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="task-edit-test-types-summary"]').text()).toContain("冲击试验（X+、Y+）");
  });

  test("shows five sample codes in task detail and edits sample codes in a separate modal", async () => {
    const { state } = installApiFetchMock({
      tasks: [createTask({ sample_count: 6 })],
      samples: Array.from({ length: 6 }, (_, index) => ({
        id: `sample-${index + 1}`,
        code: `SYLU-2026-03-001-SP-${String(index + 1).padStart(3, "0")}`,
        task_code: "SYLU-2026-03-001",
        status: "样品运输中",
        trays: [{ tray_code: "SYLU-2026-03-001-TP-001", sample_code: `SYLU-2026-03-001-SP-${String(index + 1).padStart(3, "0")}` }],
      })),
      experimentSamples: [
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", sample_code: "SYLU-2026-03-001-SP-001" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", sample_code: "SYLU-2026-03-001-SP-002" },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");

    const preview = wrapper.get('[data-testid="task-detail-sample-code-preview"]');
    expect(preview.text()).toContain("SYLU-2026-03-001-SP-001");
    expect(preview.text()).toContain("SYLU-2026-03-001-SP-005");
    expect(preview.text()).not.toContain("SYLU-2026-03-001-SP-006");

    await wrapper.get('[data-testid="open-sample-codes-editor"]').trigger("click");
    expect(wrapper.find('[data-testid="task-sample-codes-modal"].modal.is-open').exists()).toBe(true);

    await wrapper.get('[data-testid="task-sample-codes-textarea"]').setValue(
      "SYLU-2026-03-001-SP-101\nSYLU-2026-03-001-SP-102",
    );
    await wrapper.get('[data-testid="task-sample-codes-confirm"]').trigger("click");
    await settle(wrapper);

    expect(state.samples.filter((sample) => sample.task_code === "SYLU-2026-03-001").map((sample) => sample.code)).toEqual([
      "SYLU-2026-03-001-SP-101",
      "SYLU-2026-03-001-SP-102",
    ]);
    expect(state.samples.filter((sample) => sample.task_code === "SYLU-2026-03-001").map((sample) => sample.trays[0].sample_code)).toEqual([
      "SYLU-2026-03-001-SP-101",
      "SYLU-2026-03-001-SP-102",
    ]);
    expect(state.experimentSamples).toEqual([
      { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", sample_code: "SYLU-2026-03-001-SP-101" },
      { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", sample_code: "SYLU-2026-03-001-SP-102" },
    ]);
    expect(state.tasks[0].sample_count).toBe(2);
    expect(wrapper.find('[data-testid="task-sample-codes-modal"].modal.is-open').exists()).toBe(false);
    expect(wrapper.get('[data-testid="task-detail-sample-code-preview"]').text()).toContain("SYLU-2026-03-001-SP-101");
  });

  test("limits task detail sample code count to the task sample count", async () => {
    installApiFetchMock({
      tasks: [createTask({ sample_count: 99 })],
      samples: Array.from({ length: 101 }, (_, index) => ({
        id: `sample-${index + 1}`,
        code: `SYLU-2026-03-001-SP-${String(index + 1).padStart(3, "0")}`,
        task_code: "SYLU-2026-03-001",
        status: "样品运输中",
      })),
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");

    expect(wrapper.text()).toContain("共 99 个，显示前 5 个");
    expect(wrapper.text()).not.toContain("共 101 个");
  });

  test("previews generated sample codes up to the edited sample count", async () => {
    installApiFetchMock({
      tasks: [createTask({ sample_count: 12 })],
      samples: Array.from({ length: 12 }, (_, index) => ({
        id: `sample-${index + 1}`,
        code: `SYLU-2026-03-001-SP-${String(index + 1).padStart(3, "0")}`,
        task_code: "SYLU-2026-03-001",
        status: "样品运输中",
      })),
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-detail-modal"] input[name="sample_count"]').setValue("99");
    await settle(wrapper);

    expect(wrapper.text()).toContain("共 99 个，显示前 5 个");
    expect(wrapper.get('[data-testid="task-detail-sample-code-preview"]').text()).toContain("SYLU-2026-03-001-SP-005");
  });

  test("does not mention showing the first five sample codes when fewer than five exist", async () => {
    installApiFetchMock({
      tasks: [createTask({ sample_count: 2 })],
      samples: [
        {
          id: "sample-1",
          code: "SYLU-2026-03-001-SP-001",
          task_code: "SYLU-2026-03-001",
          status: "样品运输中",
        },
        {
          id: "sample-2",
          code: "SYLU-2026-03-001-SP-002",
          task_code: "SYLU-2026-03-001",
          status: "样品运输中",
        },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");

    expect(wrapper.text()).toContain("共 2 个");
    expect(wrapper.text()).not.toContain("显示前 5 个");
  });

  test("updates the sort arrow direction on repeated header clicks", async () => {
    installApiFetchMock({
      tasks: [
        createTask({ id: "task-1", code: "SYLU-2026-03-001" }),
        createTask({ id: "task-2", code: "SYLU-2026-03-002" }),
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    const codeHeader = wrapper.get(".tasks-table__col--code");

    expect(codeHeader.attributes("data-sort-dir")).toBe("");

    await codeHeader.trigger("click");
    await settle(wrapper);

    expect(codeHeader.attributes("data-sort-dir")).toBe("asc");

    await codeHeader.trigger("click");
    await settle(wrapper);

    expect(codeHeader.attributes("data-sort-dir")).toBe("desc");
  });

  test("sorts the sample count column numerically instead of lexically", async () => {
    installApiFetchMock({
      tasks: [
        createTask({ id: "task-10", code: "SYLU-2026-03-010", sample_count: 10 }),
        createTask({ id: "task-2", code: "SYLU-2026-03-002", sample_count: 2 }),
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    const sampleHeader = wrapper.get(".tasks-table__col--sample-count");

    await sampleHeader.trigger("click");
    await settle(wrapper);

    let rows = wrapper.findAll("#task-table tbody tr");
    expect(rows.map((row) => row.get(".tasks-table__cell--sample-count").text())).toEqual(["2", "10"]);

    await sampleHeader.trigger("click");
    await settle(wrapper);

    rows = wrapper.findAll("#task-table tbody tr");
    expect(rows.map((row) => row.get(".tasks-table__cell--sample-count").text())).toEqual(["10", "2"]);
  });

  test("uses compact side columns while prioritizing the experiment summary column", async () => {
    installApiFetchMock({
      tasks: [
        createTask({
          id: "task-layout-1",
          code: "SYLU-2026-03-020",
          name: "多实验布局任务",
          source: "内部新增",
          sample_count: 6,
          test_type: "高低温湿热试验 / 振动试验 / 霉菌试验",
          required_device: "高低温湿热试验",
          due_at: "2026-03-20 08:00",
          arrival_at: "2026-03-18 09:00",
          created_at: "2026-03-18T08:00:00.000Z",
        }),
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.get("#task-table").classes()).toContain("tasks-table");
    expect(wrapper.get("th.tasks-table__col--index").text()).toBe("序号");
    expect(wrapper.get("th.tasks-table__col--sample-count").text()).toBe("样品");
    expect(wrapper.get("th.tasks-table__col--summary").text()).toBe("实验摘要");
    expect(wrapper.get("td.tasks-table__cell--summary .tasks-table__summary-text").text()).toBe("高低温湿热试验 / 振动试验 / 霉菌试验");
  });

  test("filters by atomic experiment type while hiding combined summaries from the filter dropdown", async () => {
    installApiFetchMock({
      tasks: [
        createTask({
          code: "SYLU-2026-03-001",
          name: "多实验任务",
          test_type: "冲击试验 / 盐雾试验 / 冲击试验",
        }),
        createTask({
          id: "task-2",
          code: "SYLU-2026-03-002",
          name: "霉菌任务",
          source: "内部新增",
          priority: "中",
          sample_count: 4,
          sample_type: "粉末",
          test_type: "霉菌试验",
          required_device: "霉菌试验",
          due_at: "2026-03-14 10:00",
          arrival_at: "2026-03-13 09:00",
          created_at: "2026-03-13T09:00:00.000Z",
        }),
      ],
      experiments: [
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", experiment_type: "冲击试验" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-B", experiment_type: "盐雾试验" },
        { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-C", experiment_type: "冲击试验" },
        { task_code: "SYLU-2026-03-002", experiment_code: "SYLU-2026-03-002-A", experiment_type: "霉菌试验" },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    const filterSelect = wrapper.get("#task-list-filter-test-type");
    expect(filterSelect.text()).toContain("冲击试验");
    expect(filterSelect.text()).toContain("盐雾试验");
    expect(filterSelect.text()).not.toContain("冲击试验 / 盐雾试验 / 冲击试验");

    await filterSelect.setValue("冲击试验");
    await settle(wrapper);

    const rows = wrapper.findAll("#task-table tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("SYLU-2026-03-001");
    expect(rows[0].text()).not.toContain("SYLU-2026-03-002");
  });

  test("scopes status options and search results to the selected experiment type", async () => {
    installApiFetchMock({
      tasks: [
        createTask({
          id: "task-impact-waiting",
          code: "SYLU-2026-03-101",
          name: "冲击待排任务",
          test_type: "冲击试验",
          status: "待排程",
        }),
        createTask({
          id: "task-impact-scheduled",
          code: "SYLU-2026-03-102",
          name: "冲击已排任务",
          test_type: "冲击试验",
          status: "已排程",
        }),
        createTask({
          id: "task-mold-running",
          code: "SYLU-2026-03-103",
          name: "霉菌进行任务",
          test_type: "霉菌试验",
          status: "任务进行中",
        }),
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    const typeSelect = wrapper.get("#task-list-filter-test-type");
    const statusSelect = () => wrapper.get("#task-list-filter-status");
    expect(statusSelect().text()).toContain("待排程");
    expect(statusSelect().text()).toContain("已排程");
    expect(statusSelect().text()).toContain("任务进行中");

    await typeSelect.setValue("冲击试验");
    await settle(wrapper);

    expect(statusSelect().text()).toContain("待排程");
    expect(statusSelect().text()).toContain("已排程");
    expect(statusSelect().text()).not.toContain("任务进行中");

    await statusSelect().setValue("已排程");
    await settle(wrapper);
    await wrapper.get("#task-list-search").setValue("SYLU-2026-03-102");
    await settle(wrapper);

    let rows = wrapper.findAll("#task-table tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("SYLU-2026-03-102");

    await wrapper.get("#task-list-search").setValue("SYLU-2026-03-103");
    await settle(wrapper);

    rows = wrapper.findAll("#task-table tbody tr");
    expect(rows).toHaveLength(0);

    await wrapper.get("#task-list-search").setValue("");
    await settle(wrapper);
    await typeSelect.setValue("霉菌试验");
    await settle(wrapper);
    expect(statusSelect().element.value).toBe("");
    rows = wrapper.findAll("#task-table tbody tr");
    expect(rows).toHaveLength(1);
    expect(rows[0].text()).toContain("SYLU-2026-03-103");

    await statusSelect().setValue("任务进行中");
    await settle(wrapper);
    await typeSelect.setValue("冲击试验");
    await settle(wrapper);
    expect(statusSelect().element.value).toBe("");
    rows = wrapper.findAll("#task-table tbody tr");
    expect(rows).toHaveLength(2);
  });

  test("loads tasks from the dedicated tasks api while reading related collections from storage snapshot", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-remote-1",
          code: "SYLU-2026-03-099",
          name: "远程冲击试验",
          sample_count: 2,
          due_at: "2026-03-18 18:00",
          arrival_at: "2026-03-18 12:00",
          created_at: "2026-03-18T08:00:00.000Z",
        }),
      ],
      experiments: [
        { task_code: "SYLU-2026-03-099", experiment_code: "SYLU-2026-03-099-A", experiment_type: "温度冲击" },
        { task_code: "SYLU-2026-03-099", experiment_code: "SYLU-2026-03-099-B", experiment_type: "振动" },
        { task_code: "SYLU-2026-03-099", experiment_code: "SYLU-2026-03-099-C", experiment_type: "盐雾" },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-099");
    expect(wrapper.text()).toContain("温度冲击 / 振动 / 盐雾");
    expect(wrapper.text()).not.toContain("设备要求");
    expect(fetchMock).toHaveBeenCalledWith(
      `${TASKS_ENDPOINT}?includeArchived=true`,
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  test("renders partial experiment completion as running with a completed count suffix", async () => {
    installApiFetchMock({
      tasks: [
        createTask({
          id: "task-remote-2",
          code: "SYLU-2026-03-100",
          name: "远程多实验任务",
          sample_count: 2,
          test_type: "冲击试验 / 振动试验",
          due_at: "2026-03-18 18:00",
          arrival_at: "2026-03-18 12:00",
          created_at: "2026-03-18T08:00:00.000Z",
        }),
      ],
      experiments: [
        { task_code: "SYLU-2026-03-100", experiment_code: "SYLU-2026-03-100-A", experiment_name: "冲击试验", status: "实验已经完成" },
        { task_code: "SYLU-2026-03-100", experiment_code: "SYLU-2026-03-100-B", experiment_name: "振动试验", status: "待排程" },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("任务进行中（已完成1个实验）");
    expect(wrapper.get(".tasks-table__cell--status .status").classes()).toContain("running");
  });

  test("shows a localized date-time hint and current-time minimum in the intake modal", async () => {
    installApiFetchMock({
      tasks: [createTask()],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    const dueInput = wrapper.get('input[name="due_at"]');

    expect(dueInput.attributes("type")).toBe("text");
    expect(dueInput.attributes("data-format-hint")).toBe("年 / 月 / 日 --:--");
    expect(dueInput.attributes("min")).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  test("shows only the auto-writeback text for empty arrival fields before storage confirmation", async () => {
    installApiFetchMock({
      tasks: [createTask({ arrival_at: "" })],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    const intakeArrivalField = wrapper.get('.tasks-intake-modal input[name="arrival_at"]').element.closest(".picker-only-input");
    expect(intakeArrivalField.textContent).toContain("确认入库后自动回写");
    expect(intakeArrivalField.textContent).not.toContain("年 / 月 / 日");

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await settle(wrapper);

    const detailArrivalField = wrapper.get('[data-testid="task-detail-modal"] input[name="arrival_at"]').element.closest(".picker-only-input");
    expect(detailArrivalField.textContent).toContain("确认入库后自动回写");
    expect(detailArrivalField.textContent).not.toContain("年 / 月 / 日");
  });

  test("opens the intake modal from the route hash, supports multi-select experiments, and submits a task", async () => {
    const { state } = installApiFetchMock({
      tasks: [createTask()],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.get('input[name="code"]').element.value).toBe(buildCurrentMonthFirstTaskCode());

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    expect(wrapper.get('[data-testid="task-intake-test-types-modal"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="task-intake-test-types-summary"]').text()).toContain("请选择试验类型");
    expect(wrapper.get('[data-testid="task-intake-test-types-grid"]').classes()).toContain("tasks-intake-test-types__grid");
    expect(wrapper.get('[data-testid="task-intake-test-types-modal"]').text()).not.toContain("已选");
    expect(wrapper.get('[data-testid="task-intake-test-types-modal"]').text()).not.toContain("未选");
    await wrapper.get('[data-testid="task-intake-test-type-option-冲击试验"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.get('[data-testid="task-intake-axis-modal"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="task-intake-test-type-option-冲击试验"]').classes()).not.toContain("is-selected");
    expect(wrapper.get('[data-testid="task-intake-test-type-check-冲击试验"]').text()).not.toContain("✓");
    expect(wrapper.get('[data-testid="task-intake-test-types-summary"]').text()).not.toContain("冲击试验");
    for (const axisCode of DEFAULT_AXIS_CODES.filter((code) => code !== "x+")) {
      await wrapper.get(`[data-testid="task-intake-axis-option-${axisCode}"]`).trigger("click");
    }
    await wrapper.get('[data-testid="task-intake-axis-confirm"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.get('[data-testid="task-intake-test-type-option-冲击试验"]').classes()).toContain("is-selected");
    expect(wrapper.get('[data-testid="task-intake-test-type-check-冲击试验"]').text()).toContain("✓");
    await wrapper.get('[data-testid="task-intake-test-type-option-盐雾试验"]').trigger("click");
    expect(wrapper.get('[data-testid="task-intake-test-types-summary"]').text()).toContain("冲击试验（X+） / 盐雾试验");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await settle(wrapper);

    const codeInput = wrapper.get('input[name="code"]');

    const expectedTaskCode = buildCurrentMonthFirstTaskCode();

    expect(codeInput.element.value).toBe(expectedTaskCode);
    expect(wrapper.get('[data-testid="task-intake-test-types-trigger"]').text()).toContain("冲击试验（X+） / 盐雾试验");
    expect(wrapper.get('[data-testid="task-intake-test-types-trigger"]').text()).not.toContain("→");
    expect(wrapper.find('input[name="required_device"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("必需设备/能力");

    await wrapper.get('input[name="name"]').setValue("冲击试验-批次B");
    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('input[name="contact_info"]').setValue("13800001234");
    await wrapper.get('input[name="sample_count"]').setValue("3");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(state.tasks).toHaveLength(2);
    expect(state.tasks[0]).toEqual(
      expect.objectContaining({
        code: expectedTaskCode,
        name: "冲击试验-批次B",
        test_type: "冲击试验 / 盐雾试验",
        test_types: ["冲击试验", "盐雾试验"],
        axis_codes_by_test_type: {
          冲击试验: ["x+"],
        },
      }),
    );
  });

  test("blocks garbled symbol input in the intake form before creating a task", async () => {
    const { fetchMock, state } = installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    await selectIntakeAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('input[name="name"]').setValue("&^*(&U&^GFG&HU&");
    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('input[name="contact_info"]').setValue("13800001234");
    await wrapper.get('input[name="sample_count"]').setValue("3");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("任务名称包含无效字符，请检查输入");
    expect(state.tasks).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url, options]) => url === TASKS_ENDPOINT && options?.method === "POST")).toBe(false);
  });

  test("validates intake phone and sample count by field rules", async () => {
    const { fetchMock, state } = installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    await selectIntakeAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('input[name="name"]').setValue("字段校验任务");
    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('input[name="contact_info"]').setValue("1380000ABC");
    await wrapper.get('input[name="sample_count"]').setValue("100");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("联系方式必须为 1-15 位数字");
    expect(wrapper.get('input[name="sample_count"]').element.value).toBe("99");
    expect(state.tasks).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url, options]) => url === TASKS_ENDPOINT && options?.method === "POST")).toBe(false);
  });

  test("requires contact and phone before submitting a new task", async () => {
    const { fetchMock, state } = installApiFetchMock({ tasks: [], samples: [] });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    await selectIntakeAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await wrapper.get('input[name="sample_count"]').setValue("3");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("请填写联系人");

    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("请填写联系方式");
    expect(state.tasks).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url, options]) => url === TASKS_ENDPOINT && options?.method === "POST")).toBe(false);
  });

  test("uses master test type options for intake selections when available", async () => {
    installApiFetchMock({
      tasks: [
        createTask({
          id: "dirty-task-type",
          code: "SYLU-2026-05-002",
          name: "演示任务002",
          test_type: "演示任务002",
          test_types: ["演示任务002"],
          required_device: "演示任务002",
        }),
      ],
      samples: [],
      testTypes: [{ code: "CUSTOM", name: "自定义试验" }],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");

    expect(wrapper.get('[data-testid="task-intake-test-type-option-自定义试验"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="task-intake-test-type-option-演示任务002"]').exists()).toBe(false);
  });

  test("falls back to built-in intake experiment options when master data fails", async () => {
    installApiFetchMock({
      tasks: [],
      samples: [],
      testTypesError: { status: 503, statusText: "Unavailable" },
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");

    expect(wrapper.get('[data-testid="task-intake-test-type-option-冲击试验"]').exists()).toBe(true);
  });

  test("uses archived returned task codes when generating a new intake task number", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-20T08:00:00.000Z"));
    try {
      const { fetchMock, state } = installApiFetchMock({
        tasks: [
          createTask({
            id: "task-returned",
            code: "SYLU-2026-05-001",
            status: "厂家收回",
            transfer_status: "厂家收回",
          }),
        ],
        samples: [
          {
            id: "sample-returned",
            code: "SYLU-2026-05-001-SP-001",
            task_code: "SYLU-2026-05-001",
            status: "厂家收回",
            flow_status: "厂家收回",
            trays: [{ tray_code: "SYLU-2026-05-001-TP-001", status: "厂家收回" }],
          },
        ],
      });
      window.location.hash = "#task-intake-modal";

      const wrapper = mount(TasksPage);
      await settle(wrapper);

      await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
      await selectIntakeAxisExperiment(wrapper, "冲击试验");
      await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
      await settle(wrapper);

      expect(wrapper.get('input[name="code"]').element.value).toBe("SYLU-2026-05-002");

      await wrapper.get('input[name="name"]').setValue("归档后新任务");
      await wrapper.get('input[name="contact"]').setValue("张三");
      await wrapper.get('input[name="contact_info"]').setValue("13800001234");
      await wrapper.get('input[name="sample_count"]').setValue("2");
      await wrapper.get('[data-testid="task-submit"]').trigger("click");
      await settle(wrapper);

      expect(fetchMock).toHaveBeenCalledWith(
        `${TASKS_ENDPOINT}?includeArchived=true`,
        expect.objectContaining({
          credentials: "include",
        }),
      );
      expect(state.tasks[0]).toEqual(
        expect.objectContaining({
          code: "SYLU-2026-05-002",
          name: "归档后新任务",
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  test("submits an intake task after selecting all experiment types", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    for (const experimentType of ALL_EXPERIMENT_TYPES) {
      if (["冲击试验", "振动试验"].includes(experimentType)) {
        await selectIntakeAxisExperiment(wrapper, experimentType);
        continue;
      }
      await wrapper.get(`[data-testid="task-intake-test-type-option-${experimentType}"]`).trigger("click");
    }
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await wrapper.get('input[name="name"]').setValue("全实验新增任务");
    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('input[name="contact_info"]').setValue("13800001234");
    await wrapper.get('input[name="sample_count"]').setValue("2");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    const createTaskCall = fetchMock.mock.calls.find(
      ([url, options]) => url === TASKS_ENDPOINT && options?.method === "POST",
    );
    const payload = JSON.parse(createTaskCall[1].body);

    expect(payload.test_types).toHaveLength(ALL_EXPERIMENT_TYPES.length);
    expect(payload.test_types).toEqual(expect.arrayContaining(ALL_EXPERIMENT_TYPES));
    expect(payload.axis_codes_by_test_type).toEqual({
      冲击试验: DEFAULT_AXIS_CODES,
      振动试验: DEFAULT_AXIS_CODES,
    });
    expect(payload.test_type).toContain("冲击试验");
    expect(payload.test_type).toContain("霉菌试验");
    expect(wrapper.text()).not.toContain("任务提交失败");
  });

  test("saves the intake form as a draft without creating a task", async () => {
    const { fetchMock, state } = installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    await selectIntakeAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await settle(wrapper);

    await wrapper.get('input[name="name"]').setValue("草稿任务");
    await wrapper.get('input[name="sample_count"]').setValue("5");
    await wrapper.get('input[name="client"]').setValue("草稿客户");
    await wrapper.get('[data-testid="task-draft"]').trigger("click");
    await settle(wrapper);

    const createCalls = fetchMock.mock.calls.filter(([url, options = {}]) => url === TASKS_ENDPOINT && options.method === "POST");
    expect(createCalls).toHaveLength(0);
    expect(state.tasks).toHaveLength(0);
    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("任务草稿已保存");

    await wrapper.get(".modal.is-open .modal-close").trigger("click");
    await settle(wrapper);
    expect(wrapper.find(".modal.is-open").exists()).toBe(false);

    window.dispatchEvent(new CustomEvent("mes:open-task-intake"));
    await settle(wrapper);

    expect(wrapper.get('input[name="name"]').element.value).toBe("草稿任务");
    expect(wrapper.get('input[name="sample_count"]').element.value).toBe("5");
    expect(wrapper.get('input[name="client"]').element.value).toBe("草稿客户");
    expect(wrapper.get('[data-testid="task-intake-test-types-trigger"]').text()).toContain("冲击试验");
  });

  test("shows arrival time as a read-only field in intake and edit forms", async () => {
    installApiFetchMock({
      tasks: [
        createTask({
          sample_count: 2,
          arrival_at: "2026-03-18 08:00",
          due_at: "",
          created_at: "2026-03-18T08:00:00.000Z",
        }),
      ],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    const intakeArrivalInput = wrapper.get('input[name="arrival_at"]');
    expect(intakeArrivalInput.element.readOnly).toBe(true);
    await intakeArrivalInput.trigger("click");
    expect(wrapper.find(".picker-only-calendar").exists()).toBe(false);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await settle(wrapper);

    const drawerArrivalInput = wrapper.find('[data-testid="task-detail-modal"] input[name="arrival_at"]');
    expect(drawerArrivalInput.element.readOnly).toBe(true);
  });

  test("submits tasks through the dedicated tasks api and only persists dependent collections through storage", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    await selectIntakeAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-intake-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await wrapper.get('input[name="name"]').setValue("冲击试验-批次C");
    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('input[name="contact_info"]').setValue("13800001234");
    await wrapper.get('input[name="sample_count"]').setValue("2");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(fetchMock).toHaveBeenCalledWith(
      TASKS_ENDPOINT,
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );
    const createTaskCall = fetchMock.mock.calls.find(
      ([url, options]) => url === TASKS_ENDPOINT && options?.method === "POST",
    );
    expect(JSON.parse(createTaskCall[1].body)).toEqual(
      expect.objectContaining({
        test_type: "冲击试验 / 盐雾试验",
        test_types: ["冲击试验", "盐雾试验"],
      }),
    );

    const storageWriteCall = fetchMock.mock.calls.find(
      ([url, options]) => url === STORAGE_ENDPOINT && options?.method === "PUT",
    );
    expect(storageWriteCall).toBeTruthy();
    expect(JSON.parse(storageWriteCall[1].body)).toEqual({
      [SAMPLES_KEY]: expect.any(Array),
    });
  });

  test("edits task experiment types through the same multi-select picker and saves only type names", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-edit-1",
          code: "SYLU-2026-03-001",
          name: "演示任务001",
          test_type: "冲击试验",
          test_types: ["冲击试验"],
          required_device: "冲击试验",
        }),
      ],
      experiments: [
        {
          task_code: "SYLU-2026-03-001",
          experiment_code: "SYLU-2026-03-001-A",
          experiment_name: "演示任务001-A",
        },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.get("td.tasks-table__cell--summary .tasks-table__summary-text").text()).toBe("冲击试验");

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await settle(wrapper);

    const detailModal = wrapper.get('[data-testid="task-detail-modal"]');
    expect(detailModal.find('select[name="status"]').exists()).toBe(false);
    expect(detailModal.get('[data-testid="task-edit-status-readonly"]').attributes("readonly")).toBeDefined();
    expect(detailModal.get('[data-testid="task-edit-status-readonly"]').element.value).toBe("待排程");
    expect(wrapper.get('[data-testid="task-edit-test-types-trigger"]').text()).toContain("冲击试验");
    expect(wrapper.get('[data-testid="task-edit-test-types-trigger"]').text()).not.toContain("演示任务001-A");

    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-霉菌试验"]').trigger("click");
    await removeEditAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-scheduled-removal-confirm-ok"]').trigger("click");
    await settle(wrapper);

    const updateCall = fetchMock.mock.calls.find(
      ([url, options]) => url === buildTaskEndpoint("task-edit-1") && options?.method === "PUT",
    );
    expect(JSON.parse(updateCall[1].body)).toEqual(
      expect.objectContaining({
        required_device: "盐雾试验 / 霉菌试验",
        test_type: "盐雾试验 / 霉菌试验",
        test_types: ["盐雾试验", "霉菌试验"],
      }),
    );
  });

  test("locks non-name task detail fields while the task is running", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-running-lock",
          code: "SYLU-2026-06-310",
          name: "进行中任务",
          source: "外部委托",
          priority: "中",
          sample_type: "金属件",
          due_at: "2026-06-20 18:00",
          test_type: "盐雾试验",
          test_types: ["盐雾试验"],
          status: "任务进行中",
        }),
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await settle(wrapper);

    const detailModal = wrapper.get('[data-testid="task-detail-modal"]');
    expect(detailModal.get('input[name="name"]').attributes("readonly")).toBeUndefined();
    expect(detailModal.get('select[name="source"]').attributes("disabled")).toBeDefined();
    expect(detailModal.get('select[name="priority"]').attributes("disabled")).toBeDefined();
    expect(detailModal.get('input[name="sample_type"]').attributes("readonly")).toBeDefined();
    expect(wrapper.get('[data-testid="task-edit-test-types-trigger"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get('[data-testid="open-sample-codes-editor"]').attributes("disabled")).toBeDefined();
    expect(detailModal.get('textarea[name="remark"]').attributes("readonly")).toBeDefined();
    expect(wrapper.get('[data-testid="task-update"]').attributes("disabled")).toBeUndefined();

    await detailModal.get('input[name="name"]').setValue("进行中任务-修改");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);

    const updateCall = fetchMock.mock.calls.find(
      ([url, options]) => url === buildTaskEndpoint("task-running-lock") && options?.method === "PUT",
    );
    expect(JSON.parse(updateCall[1].body)).toEqual(
      expect.objectContaining({
        name: "进行中任务-修改",
        source: "外部委托",
        priority: "中",
        sample_type: "金属件",
        due_at: "2026-06-20 18:00",
        test_types: ["盐雾试验"],
      }),
    );
  });

  test("does not reopen the intake modal after saving task edits when router hash is stale", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-edit-stale-hash",
          code: "SYLU-2026-03-001",
          name: "原任务名称",
          test_type: "冲击试验",
          test_types: ["冲击试验"],
        }),
      ],
    });
    window.location.hash = "#task-intake-modal";
    routeState.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".tasks-intake-modal.modal.is-open").exists()).toBe(true);

    await wrapper.get(".tasks-intake-modal .modal-close").trigger("click");
    await settle(wrapper);

    expect(window.location.hash).toBe("");
    expect(routeState.hash).toBe("#task-intake-modal");
    expect(wrapper.find(".tasks-intake-modal.modal.is-open").exists()).toBe(false);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-detail-modal"] input[name="name"]').setValue("修改后的任务");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);

    expect(fetchMock.mock.calls.some(([url, options]) => url === buildTaskEndpoint("task-edit-stale-hash") && options?.method === "PUT")).toBe(true);
    expect(wrapper.find(".tasks-intake-modal.modal.is-open").exists()).toBe(false);
    expect(wrapper.find('[data-testid="task-detail-modal"].modal.is-open').exists()).toBe(false);
  });

  test("refreshes experiment metadata after changing three experiment types to one", async () => {
    installApiFetchMock({
      tasks: [
        createTask({
          id: "task-edit-three-to-one",
          code: "SYLU-2026-05-003",
          name: "三实验改一实验",
          sample_count: 8,
          test_type: "温度冲击试验 / 高低温湿热试验 / 盐雾试验",
          test_types: ["温度冲击试验", "高低温湿热试验", "盐雾试验"],
          required_device: "温度冲击试验 / 高低温湿热试验 / 盐雾试验",
          experiment_codes: ["SYLU-2026-05-003-A", "SYLU-2026-05-003-B", "SYLU-2026-05-003-C"],
          experiment_count: 3,
        }),
      ],
      experiments: [
        {
          task_code: "SYLU-2026-05-003",
          experiment_code: "SYLU-2026-05-003-A",
          experiment_name: "温度冲击试验",
          required_device: "温度冲击试验",
        },
        {
          task_code: "SYLU-2026-05-003",
          experiment_code: "SYLU-2026-05-003-B",
          experiment_name: "高低温湿热试验",
          required_device: "高低温湿热试验",
        },
        {
          task_code: "SYLU-2026-05-003",
          experiment_code: "SYLU-2026-05-003-C",
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
        },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.get("td.tasks-table__cell--summary .tasks-table__summary-text").text()).toBe(
      "温度冲击试验 / 高低温湿热试验 / 盐雾试验",
    );

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-温度冲击试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-高低温湿热试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-四综合试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-scheduled-removal-confirm-ok"]').trigger("click");
    await settle(wrapper);

    const summary = wrapper.get("td.tasks-table__cell--summary .tasks-table__summary-text").text();
    expect(summary).toBe("四综合试验");
    expect(summary).not.toContain("温度冲击试验");
    expect(summary).not.toContain("高低温湿热试验");
    expect(summary).not.toContain("盐雾试验");
  });

  test("blocks experiment type changes after transfer storage is confirmed", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-storage-confirmed",
          code: "SYLU-2026-05-004",
          name: "已确认到货任务",
          test_type: "冲击试验",
          test_types: ["冲击试验"],
          required_device: "冲击试验",
          transfer_status: "到货",
        }),
      ],
      samples: [
        {
          id: "SYLU-2026-05-004-SP-001",
          code: "SYLU-2026-05-004-SP-001",
          task_code: "SYLU-2026-05-004",
          status: "到货",
          flow_status: "到货",
          trays: [{ tray_code: "SYLU-2026-05-004-TP-001", status: "到货" }],
        },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await removeEditAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-edit-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("该任务样品已在接驳区确认到货，不允许更改实验类型");
    expect(fetchMock.mock.calls.some(([url, options]) => url === buildTaskEndpoint("task-storage-confirmed") && options?.method === "PUT")).toBe(
      false,
    );
  });

  test("allows experiment type changes when only legacy stored status exists", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-legacy-stored",
          code: "SYLU-2026-05-104",
          name: "旧状态任务",
          test_type: "冲击试验",
          test_types: ["冲击试验"],
          required_device: "冲击试验",
          transfer_status: "已入库",
        }),
      ],
      samples: [
        {
          id: "SYLU-2026-05-104-SP-001",
          code: "SYLU-2026-05-104-SP-001",
          task_code: "SYLU-2026-05-104",
          status: "已入库",
          flow_status: "已入库",
          trays: [{ tray_code: "SYLU-2026-05-104-TP-001", status: "已入库" }],
        },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await removeEditAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-edit-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-scheduled-removal-confirm-ok"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).not.toContain("该任务样品已在接驳区确认到货，不允许更改实验类型");
    expect(fetchMock.mock.calls.some(([url, options]) => url === buildTaskEndpoint("task-legacy-stored") && options?.method === "PUT")).toBe(
      true,
    );
  });

  test("confirms and removes schedules for deleted scheduled experiment types", async () => {
    const { fetchMock, state } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-scheduled-removal",
          code: "SYLU-2026-05-005",
          name: "删除已排程实验",
          test_type: "冲击试验 / 盐雾试验",
          test_types: ["冲击试验", "盐雾试验"],
          required_device: "冲击试验 / 盐雾试验",
          experiment_codes: ["SYLU-2026-05-005-A", "SYLU-2026-05-005-B"],
          experiment_count: 2,
        }),
      ],
      experiments: [
        {
          task_code: "SYLU-2026-05-005",
          experiment_code: "SYLU-2026-05-005-A",
          experiment_name: "冲击试验",
          required_device: "冲击试验",
        },
        {
          task_code: "SYLU-2026-05-005",
          experiment_code: "SYLU-2026-05-005-B",
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
        },
      ],
      schedules: [
        {
          id: "SCH-KEEP",
          task_code: "SYLU-2026-05-005",
          experiment_code: "SYLU-2026-05-005-A",
          device: "冲击一室",
          status: "已排程",
        },
        {
          id: "SCH-REMOVE",
          task_code: "SYLU-2026-05-005",
          experiment_code: "SYLU-2026-05-005-B",
          device: "盐雾试验室",
          status: "已排程",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-005", experiment_code: "SYLU-2026-05-005-A", tray_code: "TP-A" },
        { task_code: "SYLU-2026-05-005", experiment_code: "SYLU-2026-05-005-B", tray_code: "TP-B" },
      ],
      experimentSamples: [
        { task_code: "SYLU-2026-05-005", experiment_code: "SYLU-2026-05-005-A", sample_code: "SP-A" },
        { task_code: "SYLU-2026-05-005", experiment_code: "SYLU-2026-05-005-B", sample_code: "SP-B" },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="task-scheduled-removal-confirm"]').text()).toContain(
      "需要重新排程并从预接驳处重新分配托盘",
    );
    expect(fetchMock.mock.calls.some(([url, options]) => url === buildTaskEndpoint("task-scheduled-removal") && options?.method === "PUT")).toBe(
      false,
    );

    await wrapper.get('[data-testid="task-scheduled-removal-confirm-ok"]').trigger("click");
    await settle(wrapper);

    const updateCall = fetchMock.mock.calls.find(
      ([url, options]) => url === buildTaskEndpoint("task-scheduled-removal") && options?.method === "PUT",
    );
    expect(JSON.parse(updateCall[1].body)).toEqual(
      expect.objectContaining({
        test_types: ["冲击试验"],
        confirm_remove_scheduled_experiments: true,
      }),
    );
    expect(state.schedules).toEqual([]);
    expect(state.experimentTrays).toEqual([]);
    expect(state.experimentSamples).toEqual([]);
  });

  test("resets preallocation and old schedules when adding an experiment type", async () => {
    const { fetchMock, state } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-preallocated-add-type",
          code: "SYLU-2026-05-020",
          name: "预接驳后新增实验",
          test_type: "冲击试验",
          test_types: ["冲击试验"],
          required_device: "冲击试验",
          experiment_codes: ["SYLU-2026-05-020-A"],
          experiment_count: 1,
          transfer_status: "未入库",
          tray_codes: ["SYLU-2026-05-020-TP-001"],
        }),
      ],
      samples: [
        {
          id: "SYLU-2026-05-020-SP-001",
          code: "SYLU-2026-05-020-SP-001",
          task_code: "SYLU-2026-05-020",
          status: "运输中",
          flow_status: "运输中",
          location: "",
          trays: [{ tray_code: "SYLU-2026-05-020-TP-001", status: "未入库" }],
        },
      ],
      experiments: [
        {
          task_code: "SYLU-2026-05-020",
          experiment_code: "SYLU-2026-05-020-A",
          experiment_name: "冲击试验",
          required_device: "冲击试验",
        },
      ],
      schedules: [
        {
          id: "SCH-OLD",
          task_code: "SYLU-2026-05-020",
          experiment_code: "SYLU-2026-05-020-A",
          device: "冲击一室",
          status: "已排程",
        },
        {
          id: "SCH-OTHER",
          task_code: "OTHER",
          experiment_code: "OTHER-A",
          device: "盐雾试验室",
          status: "已排程",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-020", experiment_code: "SYLU-2026-05-020-A", tray_code: "SYLU-2026-05-020-TP-001" },
        { task_code: "OTHER", experiment_code: "OTHER-A", tray_code: "OTHER-TP-001" },
      ],
      experimentSamples: [
        { task_code: "SYLU-2026-05-020", experiment_code: "SYLU-2026-05-020-A", sample_code: "SYLU-2026-05-020-SP-001" },
        { task_code: "OTHER", experiment_code: "OTHER-A", sample_code: "OTHER-SP-001" },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="task-scheduled-removal-confirm"]').text()).toContain(
      "需要重新排程并从预接驳处重新分配托盘",
    );

    await wrapper.get('[data-testid="task-scheduled-removal-confirm-ok"]').trigger("click");
    await settle(wrapper);

    const updateCall = fetchMock.mock.calls.find(
      ([url, options]) => url === buildTaskEndpoint("task-preallocated-add-type") && options?.method === "PUT",
    );
    expect(JSON.parse(updateCall[1].body)).toEqual(
      expect.objectContaining({
        test_types: ["冲击试验", "盐雾试验"],
        confirm_remove_scheduled_experiments: true,
        transfer_status: "未入库",
        tray_codes: [],
      }),
    );
    expect(state.tasks[0].tray_codes).toEqual([]);
    expect(state.samples[0].trays).toEqual([]);
    expect(state.samples[0].status).toBe("运输中");
    expect(state.samples[0].flow_status).toBe("运输中");
    expect(state.schedules.map((schedule) => schedule.id)).toEqual(["SCH-OTHER"]);
    expect(state.experimentTrays).toEqual([{ task_code: "OTHER", experiment_code: "OTHER-A", tray_code: "OTHER-TP-001" }]);
    expect(state.experimentSamples).toEqual([{ task_code: "OTHER", experiment_code: "OTHER-A", sample_code: "OTHER-SP-001" }]);
  });

  test("removes scheduled experiment links by the original task code when task code also changes", async () => {
    const { state } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-code-change-removal",
          code: "SYLU-2026-05-015",
          name: "改号并删除实验",
          test_type: "冲击试验 / 盐雾试验",
          test_types: ["冲击试验", "盐雾试验"],
          required_device: "冲击试验 / 盐雾试验",
          experiment_codes: ["SYLU-2026-05-015-A", "SYLU-2026-05-015-B"],
          experiment_count: 2,
        }),
      ],
      experiments: [
        {
          task_code: "SYLU-2026-05-015",
          experiment_code: "SYLU-2026-05-015-A",
          experiment_name: "冲击试验",
          required_device: "冲击试验",
        },
        {
          task_code: "SYLU-2026-05-015",
          experiment_code: "SYLU-2026-05-015-B",
          experiment_name: "盐雾试验",
          required_device: "盐雾试验",
        },
      ],
      schedules: [
        {
          id: "SCH-KEEP",
          task_code: "SYLU-2026-05-015",
          experiment_code: "SYLU-2026-05-015-A",
          device: "冲击一室",
          status: "已排程",
        },
        {
          id: "SCH-REMOVE",
          task_code: "SYLU-2026-05-015",
          experiment_code: "SYLU-2026-05-015-B",
          device: "盐雾试验室",
          status: "已排程",
        },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-015", experiment_code: "SYLU-2026-05-015-A", tray_code: "TP-A" },
        { task_code: "SYLU-2026-05-015", experiment_code: "SYLU-2026-05-015-B", tray_code: "TP-B" },
      ],
      experimentSamples: [
        { task_code: "SYLU-2026-05-015", experiment_code: "SYLU-2026-05-015-A", sample_code: "SP-A" },
        { task_code: "SYLU-2026-05-015", experiment_code: "SYLU-2026-05-015-B", sample_code: "SP-B" },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('input[name="code"]').setValue("SYLU-2026-05-099");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-scheduled-removal-confirm-ok"]').trigger("click");
    await settle(wrapper);

    expect(state.schedules).toEqual([]);
    expect(state.experimentTrays).toEqual([]);
    expect(state.experimentSamples).toEqual([]);
  });

  test("removes schedules for a retained experiment when any experiment type changes", async () => {
    const { state } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-remove-first",
          code: "SYLU-2026-05-006",
          name: "删除前序实验",
          test_type: "冲击试验 / 盐雾试验",
          test_types: ["冲击试验", "盐雾试验"],
          required_device: "冲击试验 / 盐雾试验",
          experiment_codes: ["SYLU-2026-05-006-A", "SYLU-2026-05-006-B"],
          experiment_count: 2,
        }),
      ],
      experiments: [
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-A", experiment_name: "冲击试验", required_device: "冲击试验" },
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-B", experiment_name: "盐雾试验", required_device: "盐雾试验" },
      ],
      schedules: [
        { id: "SCH-REMOVE", task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-A", device: "冲击一室", status: "已排程" },
        { id: "SCH-KEEP", task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-B", device: "盐雾试验室", status: "已排程" },
      ],
      experimentTrays: [
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-A", tray_code: "TP-A" },
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-B", tray_code: "TP-B" },
      ],
      experimentSamples: [
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-A", sample_code: "SP-A" },
        { task_code: "SYLU-2026-05-006", experiment_code: "SYLU-2026-05-006-B", sample_code: "SP-B" },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await removeEditAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-scheduled-removal-confirm-ok"]').trigger("click");
    await settle(wrapper);

    expect(state.schedules).toEqual([]);
    expect(state.experimentTrays).toEqual([]);
    expect(state.experimentSamples).toEqual([]);
  });

  test("cancels scheduled experiment removal without saving or clearing schedules", async () => {
    const { fetchMock, state } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-cancel-removal",
          code: "SYLU-2026-05-007",
          test_type: "冲击试验 / 盐雾试验",
          test_types: ["冲击试验", "盐雾试验"],
          required_device: "冲击试验 / 盐雾试验",
          experiment_codes: ["SYLU-2026-05-007-A", "SYLU-2026-05-007-B"],
        }),
      ],
      experiments: [
        { task_code: "SYLU-2026-05-007", experiment_code: "SYLU-2026-05-007-A", experiment_name: "冲击试验", required_device: "冲击试验" },
        { task_code: "SYLU-2026-05-007", experiment_code: "SYLU-2026-05-007-B", experiment_name: "盐雾试验", required_device: "盐雾试验" },
      ],
      schedules: [
        { id: "SCH-REMOVE", task_code: "SYLU-2026-05-007", experiment_code: "SYLU-2026-05-007-B", device: "盐雾试验室", status: "已排程" },
      ],
      experimentTrays: [{ task_code: "SYLU-2026-05-007", experiment_code: "SYLU-2026-05-007-B", tray_code: "TP-B" }],
      experimentSamples: [{ task_code: "SYLU-2026-05-007", experiment_code: "SYLU-2026-05-007-B", sample_code: "SP-B" }],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-scheduled-removal-confirm-cancel"]').trigger("click");
    await settle(wrapper);

    expect(fetchMock.mock.calls.some(([url, options]) => url === buildTaskEndpoint("task-cancel-removal") && options?.method === "PUT")).toBe(
      false,
    );
    expect(state.schedules.map((schedule) => schedule.id)).toEqual(["SCH-REMOVE"]);
    expect(state.experimentTrays).toEqual([{ task_code: "SYLU-2026-05-007", experiment_code: "SYLU-2026-05-007-B", tray_code: "TP-B" }]);
    expect(state.experimentSamples).toEqual([{ task_code: "SYLU-2026-05-007", experiment_code: "SYLU-2026-05-007-B", sample_code: "SP-B" }]);
  });

  test("does not save a task edit when all experiment types are cleared", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-edit-empty-types",
          code: "SYLU-2026-05-002",
          name: "演示任务002",
          sample_count: 7,
          test_type: "盐雾试验",
          test_types: ["盐雾试验"],
          required_device: "盐雾试验",
          status: "待排程",
        }),
      ],
      samples: [],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("请选择至少一个试验类型");
    expect(fetchMock.mock.calls.some(([url, options]) => url === buildTaskEndpoint("task-edit-empty-types") && options?.method === "PUT")).toBe(
      false,
    );
    expect(wrapper.get('[data-testid="task-edit-test-types-trigger"]').text()).toContain("请选择试验类型");
  });

  test("updates a task after selecting all experiment types", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [
        createTask({
          id: "task-edit-all",
          code: "SYLU-2026-03-088",
          name: "待全选任务",
          sample_count: 2,
          test_type: "冲击试验",
          test_types: ["冲击试验"],
          required_device: "冲击试验",
        }),
      ],
      samples: [],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-edit-test-types-trigger"]').trigger("click");
    for (const experimentType of ALL_EXPERIMENT_TYPES) {
      const option = wrapper.get(`[data-testid="task-edit-test-type-option-${experimentType}"]`);
      if (!option.classes().includes("is-selected")) {
        if (["冲击试验", "振动试验"].includes(experimentType)) {
          await selectEditAxisExperiment(wrapper, experimentType);
          continue;
        }
        await option.trigger("click");
      }
    }
    await wrapper.get('[data-testid="task-edit-test-types-confirm"]').trigger("click");
    await wrapper.get('[data-testid="task-update"]').trigger("click");
    await settle(wrapper);
    await wrapper.get('[data-testid="task-scheduled-removal-confirm-ok"]').trigger("click");
    await settle(wrapper);

    const updateCall = fetchMock.mock.calls.find(
      ([url, options]) => url === buildTaskEndpoint("task-edit-all") && options?.method === "PUT",
    );
    const payload = JSON.parse(updateCall[1].body);

    expect(payload.test_types).toHaveLength(ALL_EXPERIMENT_TYPES.length);
    expect(payload.test_types).toEqual(expect.arrayContaining(ALL_EXPERIMENT_TYPES));
    expect(payload.required_device).toContain("高低温湿热试验");
    expect(wrapper.text()).not.toContain("任务更新失败");
  });

  test("creates a default-named task when the intake form is submitted without a manual task name", async () => {
    const { state } = installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.get('input[name="source"]').element.value).toBe("内部新增");
    expect(wrapper.get('input[name="source"]').attributes("readonly")).toBeDefined();

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    await selectIntakeAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('input[name="contact_info"]').setValue("13800001234");
    await wrapper.get('input[name="sample_count"]').setValue("2");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    const expectedTaskCode = buildCurrentMonthFirstTaskCode();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toEqual(
      expect.objectContaining({
        code: expectedTaskCode,
        name: `测试实验${expectedTaskCode.replace(/\D/g, "").slice(-5)}`,
        source: "内部新增",
        test_type: "冲击试验",
        status: expect.any(String),
      }),
    );
  });

  test("keeps the created task visible when creation succeeds but the follow-up reload fails", async () => {
    window.location.hash = "#task-intake-modal";
    let taskReloadFailed = false;
    const fetchMock = vi.fn((url, options = {}) => {
      const method = options.method ?? "GET";
      if (url === TASKS_ENDPOINT && method === "GET") {
        if (taskReloadFailed) {
          return Promise.reject(new Error("reload failed"));
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => [createTask()],
        });
      }
      if (url === TASKS_ENDPOINT && method === "POST") {
        taskReloadFailed = true;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => JSON.parse(options.body ?? "{}"),
        });
      }
      if (isStorageGetUrl(url) && method === "GET") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            [SCHEDULES_KEY]: [],
            [SAMPLES_KEY]: [],
            [STREAMS_KEY]: [],
            [EXPERIMENTS_KEY]: [],
          }),
        });
      }
      if (url === STORAGE_ENDPOINT && method === "PUT") {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ ok: true }),
        });
      }
      return Promise.reject(new Error(`unexpected request: ${method} ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    await selectIntakeAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await wrapper.get('input[name="name"]').setValue("冲击试验-批次D");
    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('input[name="contact_info"]').setValue("13800001234");
    await wrapper.get('input[name="sample_count"]').setValue("2");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);
    await settle(wrapper);

    expect(wrapper.text()).toContain(buildCurrentMonthFirstTaskCode());
    expect(wrapper.find(".modal.is-open").exists()).toBe(false);
    expect(wrapper.text()).toContain("任务列表刷新失败");
  });

  test("requires at least one selected experiment before submitting a non-pristine intake form", async () => {
    installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('input[name="name"]').setValue("未选择实验的任务");
    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('input[name="contact_info"]').setValue("13800001234");
    await wrapper.get('input[name="sample_count"]').setValue("2");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("请选择至少一个试验类型");
  });

  test("requires a sample count before submitting a non-pristine intake form", async () => {
    const { fetchMock } = installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    await selectIntakeAxisExperiment(wrapper, "冲击试验");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await wrapper.get('input[name="name"]').setValue("冲击试验-批次E");
    await wrapper.get('input[name="contact"]').setValue("张三");
    await wrapper.get('input[name="contact_info"]').setValue("13800001234");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("请填写样品数量");
    expect(fetchMock).not.toHaveBeenCalledWith(
      TASKS_ENDPOINT,
      expect.objectContaining({ method: "POST" }),
    );
  });

  test("keeps the trigger summary unchanged when the experiment picker is cancelled", async () => {
    installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.get('[data-testid="task-intake-test-types-trigger"]').text()).toContain("请选择试验类型");

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    await wrapper.get('[data-testid="task-intake-test-type-option-冲击试验"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.get('[data-testid="task-intake-axis-modal"]').exists()).toBe(true);
    await wrapper.get('[data-testid="task-intake-axis-cancel"]').trigger("click");
    await settle(wrapper);
    expect(wrapper.get('[data-testid="task-intake-test-types-summary"]').text()).not.toContain("冲击试验");
    await wrapper.get('[data-testid="task-intake-test-types-cancel"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.get('[data-testid="task-intake-test-types-trigger"]').text()).toContain("请选择试验类型");
  });

  test("deletes a task and cascades related schedules, samples, and streams", async () => {
    const { state } = installApiFetchMock({
      tasks: [createTask({ sample_count: 2 })],
      schedules: [
        { id: "schedule-1", task_code: "SYLU-2026-03-001", device: "冲击一室", start_at: "2026-03-13 12:00", end_at: "2026-03-13 14:00" },
      ],
      samples: [
        { id: "sample-1", code: "SYLU-2026-03-001-SP-001", task_code: "SYLU-2026-03-001" },
      ],
      streams: [
        { id: "stream-1", task_code: "SYLU-2026-03-001" },
      ],
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-delete"]').trigger("click");
    await settle(wrapper);

    expect(state.tasks).toHaveLength(0);
    expect(state.schedules).toHaveLength(0);
    expect(state.samples).toHaveLength(0);
    expect(state.streams).toHaveLength(0);
  });

  test("opens the intake modal when vue-router updates the route hash on the same page", async () => {
    installApiFetchMock({ tasks: [] });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(false);

    routeState.hash = "#task-intake-modal";
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
  });

  test("opens the intake modal when the app header dispatches the open-task event", async () => {
    installApiFetchMock({ tasks: [] });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(false);

    window.dispatchEvent(new CustomEvent("mes:open-task-intake"));
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
  });

  test("opens the reset dialog from the app event and rebuilds the task list after confirmation", async () => {
    const { state, fetchMock } = installApiFetchMock({
      tasks: [createTask()],
      experiments: [{ task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", experiment_name: "冲击试验", status: "实验进行中" }],
      afterReset: {
        tasks: [
          createTask({
            id: "task-reset-1",
            code: "SYLU-2026-03-001",
            name: "演示任务001",
            test_type: "盐雾试验 / 冲击试验 / 霉菌试验",
            status: "待排程",
          }),
        ],
        experiments: [
          { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-A", experiment_name: "盐雾试验", status: "待排程" },
          { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-B", experiment_name: "冲击试验", status: "待排程" },
          { task_code: "SYLU-2026-03-001", experiment_code: "SYLU-2026-03-001-C", experiment_name: "霉菌试验", status: "待排程" },
        ],
        samples: [{ id: "sample-reset-1", code: "SYLU-2026-03-001-SP-001", task_code: "SYLU-2026-03-001", status: "运输中", flow_status: "运输中" }],
      },
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);
    const snapshotUpdated = vi.fn();
    window.addEventListener("mes:snapshot-updated", snapshotUpdated);

    window.dispatchEvent(new CustomEvent("mes:open-task-reset"));
    await settle(wrapper);

    expect(wrapper.find('[data-testid="task-reset-modal"]').exists()).toBe(true);

    await wrapper.get('[data-testid="task-reset-confirm"]').trigger("click");
    await settle(wrapper);
    await settle(wrapper);

    expect(fetchMock).toHaveBeenCalledWith(
      TASKS_RESET_ENDPOINT,
      expect.objectContaining({ method: "POST" }),
    );
    expect(state.tasks[0].test_type).toContain("盐雾试验");
    expect(wrapper.text()).toContain("任务数据已重置");
    expect(wrapper.text()).toContain("盐雾试验 / 冲击试验 / 霉菌试验");
    expect(snapshotUpdated).toHaveBeenCalledWith(expect.objectContaining({
      detail: expect.objectContaining({
        reason: "reset",
        source: "tasks",
      }),
    }));
    expect(window.localStorage.getItem("mes:snapshot-updated-at")).toContain("\"reason\":\"reset\"");
    window.removeEventListener("mes:snapshot-updated", snapshotUpdated);
  });

  test("hides the reset feedback automatically after ten seconds", async () => {
    vi.useFakeTimers();
    try {
      installApiFetchMock({
        tasks: [createTask()],
        afterReset: {
          tasks: [createTask({ id: "task-reset-1", name: "演示任务001" })],
        },
      });

      const wrapper = mount(TasksPage);
      await settle(wrapper);

      window.dispatchEvent(new CustomEvent("mes:open-task-reset"));
      await settle(wrapper);
      await wrapper.get('[data-testid="task-reset-confirm"]').trigger("click");
      await settle(wrapper);

      expect(wrapper.find('[data-testid="task-reset-feedback"]').exists()).toBe(true);

      await vi.advanceTimersByTimeAsync(9999);
      await settle(wrapper);
      expect(wrapper.find('[data-testid="task-reset-feedback"]').exists()).toBe(true);

      await vi.advanceTimersByTimeAsync(1);
      await settle(wrapper);

      expect(wrapper.find('[data-testid="task-reset-feedback"]').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  test("hides the reset feedback when the user clicks elsewhere on the page", async () => {
    installApiFetchMock({
      tasks: [createTask()],
      afterReset: {
        tasks: [createTask({ id: "task-reset-1", name: "演示任务001" })],
      },
    });

    const wrapper = mount(TasksPage, { attachTo: document.body });
    await settle(wrapper);

    window.dispatchEvent(new CustomEvent("mes:open-task-reset"));
    await settle(wrapper);
    await wrapper.get('[data-testid="task-reset-confirm"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.find('[data-testid="task-reset-feedback"]').exists()).toBe(true);

    document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    await settle(wrapper);

    expect(wrapper.find('[data-testid="task-reset-feedback"]').exists()).toBe(false);
  });

  test("shows an explicit reset error when the reset request fails", async () => {
    installApiFetchMock({
      tasks: [createTask()],
      resetError: { status: 500, statusText: "Server Error" },
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    window.dispatchEvent(new CustomEvent("mes:open-task-reset"));
    await settle(wrapper);
    await wrapper.get('[data-testid="task-reset-confirm"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("任务重置失败");
    expect(wrapper.find('[data-testid="task-reset-modal"]').exists()).toBe(true);
  });

  test("shows pending LIMS tasks, keeps details read-only, and accepts one into the task list", async () => {
    const { state } = installApiFetchMock({
      tasks: [createTask({ id: "task-existing", code: "SYLU-2026-07-020", source: "外部委托" })],
      externalTaskIntakes: [
        {
          id: "LIMS-001",
          intake_id: "LIMS-001",
          code: "SYLU-2026-07-021",
          name: "LIMS委托021",
          source: "外部委托",
          client: "37单位",
          contact: "李四",
          contact_info: "13900001234",
          priority: "高",
          sample_count: "3",
          sample_type: "金属件",
          test_types: ["盐雾试验", "振动试验"],
          test_type: "盐雾试验 / 振动试验",
          due_at: "2026-07-23 09:00",
          arrival_at: "",
          acceptance_status: "pending",
        },
      ],
    });
    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.get("#task-external-count").text()).toContain("待确认：1");
    window.dispatchEvent(new CustomEvent("mes:open-external-task-intake"));
    await settle(wrapper);
    expect(wrapper.get('[data-testid="external-task-intake-list"]').text()).toContain("SYLU-2026-07-021");

    await wrapper.get('[data-testid="external-task-intake-detail-0"]').trigger("click");
    await settle(wrapper);
    const detail = wrapper.get('[data-testid="external-task-intake-detail"]');
    expect(detail.findAll("input").some((input) => input.element.value === "37单位")).toBe(true);
    expect(detail.findAll("input").every((input) => input.attributes("readonly") !== undefined)).toBe(true);
    await wrapper.get('[data-testid="external-task-intake-postpone"]').trigger("click");
    await settle(wrapper);
    expect(state.tasks).toHaveLength(1);

    await wrapper.get('[data-testid="external-task-intake-detail-0"]').trigger("click");
    await wrapper.get('[data-testid="external-task-intake-accept"]').trigger("click");
    await settle(wrapper);

    expect(state.tasks.map((task) => task.code)).toContain("SYLU-2026-07-021");
    expect(wrapper.get("#task-external-count").text()).not.toContain("待确认");
    expect(wrapper.text()).toContain("SYLU-2026-07-021");
  });

  test("sample update event reloads tasks and refreshes the open detail modal arrival time", async () => {
    let taskLoadCount = 0;
    const fetchMock = vi.fn((url) => {
      if (url === `${TASKS_ENDPOINT}?includeArchived=true`) {
        taskLoadCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () =>
            taskLoadCount === 1
              ? [
                  createTask({
                    sample_count: 2,
                    arrival_at: "",
                    due_at: "",
                    created_at: "2026-03-18T08:00:00.000Z",
                  }),
                ]
              : [
                  createTask({
                    sample_count: 2,
                    arrival_at: "2026-03-18 09:14:45",
                    due_at: "",
                    created_at: "2026-03-18T08:00:00.000Z",
                  }),
                ],
        });
      }
      if (isStorageGetUrl(url)) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            [SCHEDULES_KEY]: [],
            [SAMPLES_KEY]: [],
            [STREAMS_KEY]: [],
          }),
        });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await settle(wrapper);

    const arrivalInput = () => wrapper.find('[data-testid="task-detail-modal"] input[name="arrival_at"]');
    expect(arrivalInput().element.value).toBe("");

    window.dispatchEvent(new CustomEvent("mes:samples-updated"));
    await settle(wrapper);

    expect(arrivalInput().element.value).toMatch(/^(?:2026-03-18T09:14:45|2026-03-18 09:14:45)(?:\.000)?$/);
  });
});
