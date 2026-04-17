import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { buildApiUrl, getFrontendApiBaseUrl } from "../../lib/apiBase.js";
import TasksPage from "./page.vue";

const SCHEDULES_KEY = "mes.schedules";
const SAMPLES_KEY = "mes.samples";
const STREAMS_KEY = "mes.streams";
const EXPERIMENTS_KEY = "mes.experiments";
const TASKS_ENDPOINT = buildApiUrl("/api/tasks", getFrontendApiBaseUrl());
const TASKS_RESET_ENDPOINT = buildApiUrl("/api/tasks/reset", getFrontendApiBaseUrl());
const STORAGE_ENDPOINT = buildApiUrl("/api/storage", getFrontendApiBaseUrl());
const buildTaskEndpoint = (taskId) => buildApiUrl(`/api/tasks/${taskId}`, getFrontendApiBaseUrl());

const routeState = reactive({ hash: "" });

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
}));

const clone = (value) => JSON.parse(JSON.stringify(value));

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

const createTasksPageFetchMock = ({
  tasks = [],
  schedules = [],
  samples = [],
  streams = [],
  experiments = [],
  afterReset = null,
  resetError = null,
} = {}) => {
  const state = {
    tasks: clone(tasks),
    schedules: clone(schedules),
    samples: clone(samples),
    streams: clone(streams),
    experiments: clone(experiments),
  };

  const fetchMock = vi.fn((url, options = {}) => {
    const method = options.method ?? "GET";

    if (url === TASKS_ENDPOINT && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => clone(state.tasks),
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

    if (url.startsWith(buildTaskEndpoint("")) && method === "PUT") {
      const taskId = url.slice(buildTaskEndpoint("").length);
      const nextTask = JSON.parse(options.body ?? "{}");
      state.tasks = state.tasks.map((task) => (task.id === taskId ? clone(nextTask) : task));
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

    if (url === STORAGE_ENDPOINT && method === "GET") {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          [SCHEDULES_KEY]: clone(state.schedules),
          [SAMPLES_KEY]: clone(state.samples),
          [STREAMS_KEY]: clone(state.streams),
          [EXPERIMENTS_KEY]: clone(state.experiments),
        }),
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
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
};

describe("TasksPage runtime", () => {
  beforeEach(() => {
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

  test("renders task rows, filters visible tasks, and opens the task drawer from API data", async () => {
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
    });

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-03-001");
    expect(wrapper.get("#task-unscheduled-count").text()).toBe("2");
    expect(wrapper.findAll("#task-table tbody tr")).toHaveLength(2);

    await wrapper.get('input[placeholder="筛选任务编号/实验摘要/样品编号"]').setValue("SYLU-2026-03-001");

    expect(wrapper.findAll("#task-table tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("SYLU-2026-03-001");

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");

    expect(wrapper.find(".drawer.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("任务详情");
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
      TASKS_ENDPOINT,
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

    await wrapper.get('[data-testid="task-intake-test-types-trigger"]').trigger("click");
    expect(wrapper.get('[data-testid="task-intake-test-types-modal"]').exists()).toBe(true);
    expect(wrapper.get('[data-testid="task-intake-test-types-summary"]').text()).toContain("请选择试验类型");
    expect(wrapper.get('[data-testid="task-intake-test-types-grid"]').classes()).toContain("tasks-intake-test-types__grid");
    expect(wrapper.get('[data-testid="task-intake-test-types-modal"]').text()).not.toContain("已选");
    expect(wrapper.get('[data-testid="task-intake-test-types-modal"]').text()).not.toContain("未选");
    await wrapper.get('[data-testid="task-intake-test-type-option-冲击试验"]').trigger("click");
    expect(wrapper.get('[data-testid="task-intake-test-type-option-冲击试验"]').classes()).toContain("is-selected");
    expect(wrapper.get('[data-testid="task-intake-test-type-check-冲击试验"]').text()).toContain("✓");
    await wrapper.get('[data-testid="task-intake-test-type-option-盐雾试验"]').trigger("click");
    expect(wrapper.get('[data-testid="task-intake-test-types-summary"]').text()).toContain("冲击试验 / 盐雾试验");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await settle(wrapper);

    const codeInput = wrapper.get('input[name="code"]');

    expect(codeInput.element.value).toBe("SYLU-2026-04-001");
    expect(wrapper.get('[data-testid="task-intake-test-types-trigger"]').text()).toContain("冲击试验 / 盐雾试验");
    expect(wrapper.get('[data-testid="task-intake-test-types-trigger"]').text()).not.toContain("→");
    expect(wrapper.find('input[name="required_device"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("必需设备/能力");

    await wrapper.get('input[name="name"]').setValue("冲击试验-批次B");
    await wrapper.get('input[name="sample_count"]').setValue("3");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(state.tasks).toHaveLength(2);
    expect(state.tasks[0]).toEqual(
      expect.objectContaining({
        code: "SYLU-2026-04-001",
        name: "冲击试验-批次B",
        test_type: "冲击试验 / 盐雾试验",
        test_types: ["冲击试验", "盐雾试验"],
      }),
    );
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

    expect(wrapper.get('input[name="arrival_at"]').element.readOnly).toBe(true);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await settle(wrapper);

    const drawerArrivalInput = wrapper.find(".drawer input[name='arrival_at']");
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
    await wrapper.get('[data-testid="task-intake-test-type-option-冲击试验"]').trigger("click");
    await wrapper.get('[data-testid="task-intake-test-type-option-盐雾试验"]').trigger("click");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await wrapper.get('input[name="name"]').setValue("冲击试验-批次C");
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

  test("creates a random task when the intake form is submitted with all default empty values", async () => {
    const { state } = installApiFetchMock({
      tasks: [],
      samples: [],
    });
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.get('select[name="source"]').element.value).toBe("内部新增");

    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toEqual(
      expect.objectContaining({
        code: expect.stringMatching(/^SYLU-\d{4}-\d{2}-\d{3}$/),
        name: expect.any(String),
        source: "内部新增",
        test_type: expect.any(String),
        status: expect.any(String),
      }),
    );
    expect(state.tasks[0].name.trim().length).toBeGreaterThan(0);
    expect(state.tasks[0].test_type.trim().length).toBeGreaterThan(0);
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
      if (url === STORAGE_ENDPOINT && method === "GET") {
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
    await wrapper.get('[data-testid="task-intake-test-type-option-冲击试验"]').trigger("click");
    await wrapper.get('[data-testid="task-intake-test-types-confirm"]').trigger("click");
    await wrapper.get('input[name="name"]').setValue("冲击试验-批次D");
    await wrapper.get('input[name="sample_count"]').setValue("2");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);
    await settle(wrapper);

    expect(wrapper.text()).toContain("SYLU-2026-04-001");
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
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(wrapper.text()).toContain("请选择至少一个试验类型");
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
    expect(wrapper.get('[data-testid="task-intake-test-types-summary"]').text()).toContain("冲击试验");
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

  test("sample update event reloads tasks and refreshes the open drawer arrival time", async () => {
    let taskLoadCount = 0;
    const fetchMock = vi.fn((url) => {
      if (url === TASKS_ENDPOINT) {
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
      if (url === STORAGE_ENDPOINT) {
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

    const arrivalInput = () => wrapper.find(".drawer input[name='arrival_at']");
    expect(arrivalInput().element.value).toBe("");

    window.dispatchEvent(new CustomEvent("mes:samples-updated"));
    await settle(wrapper);

    expect(arrivalInput().element.value).toMatch(/^2026-03-18T09:14:45(?:\.000)?$/);
  });
});
