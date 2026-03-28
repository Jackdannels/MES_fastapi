import { mount } from "@vue/test-utils";
import { reactive } from "vue";
import { beforeEach, afterEach, describe, expect, test, vi } from "vitest";

import TasksPage from "./page.vue";

const TASKS_KEY = "mes.tasks";
const SCHEDULES_KEY = "mes.schedules";
const SAMPLES_KEY = "mes.samples";
const STREAMS_KEY = "mes.streams";
const EXPERIMENTS_KEY = "mes.experiments";

let storageState = {};
const routeState = reactive({ hash: "" });

vi.mock("vue-router", () => ({
  useRoute: () => routeState,
}));

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

describe("TasksPage runtime", () => {
  beforeEach(() => {
    resetStorage();
    window.location.hash = "";
    routeState.hash = "";
    vi.stubGlobal("localStorage", createStorageStub());
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("offline"))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetStorage();
    window.location.hash = "";
    routeState.hash = "";
  });

  test("renders task rows, filters visible tasks, and opens the task drawer from Vue state", async () => {
    setStorage(TASKS_KEY, [
      {
        id: "task-1",
        code: "CJ-2026-001",
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
      },
      {
        id: "task-2",
        code: "MJ-2026-001",
        name: "霉菌试验",
        source: "内部新增",
        priority: "中",
        sample_count: 4,
        sample_type: "粉末",
        test_type: "霉菌试验",
        required_device: "霉菌试验",
        due_at: "2026-03-14 10:00",
        arrival_at: "2026-03-13 09:00",
        status: "待排程",
        created_at: "2026-03-13T09:00:00.000Z",
      },
    ]);
    setStorage(SCHEDULES_KEY, []);

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("CJ-2026-001");
    expect(wrapper.findAll("#task-table tbody tr")).toHaveLength(2);

    await wrapper.get('input[placeholder="筛选任务编号/实验摘要/样品编号"]').setValue("CJ-2026");

    expect(wrapper.findAll("#task-table tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("CJ-2026-001");

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");

    expect(wrapper.find(".drawer.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("任务详情");
  });

  test("loads tasks from the dedicated tasks api while reading related collections from storage snapshot", async () => {
    const fetchMock = vi.fn((url) => {
      if (url === "/api/tasks") {
        return Promise.resolve({
          ok: true,
          json: async () => [
            {
              id: "task-remote-1",
              code: "CJ-2026-099",
              name: "远程冲击试验",
              source: "外部委托",
              priority: "高",
              sample_count: 2,
              sample_type: "结构件",
              test_type: "冲击试验",
              required_device: "冲击试验",
              due_at: "2026-03-18 18:00",
              arrival_at: "2026-03-18 12:00",
              status: "待排程",
              created_at: "2026-03-18T08:00:00.000Z",
            },
          ],
        });
      }
      if (url === "/api/storage") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            [SCHEDULES_KEY]: [],
            [SAMPLES_KEY]: [],
            [STREAMS_KEY]: [],
            [EXPERIMENTS_KEY]: [
              { task_code: "CJ-2026-099", experiment_code: "CJ-2026-099-A", experiment_type: "温度冲击" },
              { task_code: "CJ-2026-099", experiment_code: "CJ-2026-099-B", experiment_type: "振动" },
              { task_code: "CJ-2026-099", experiment_code: "CJ-2026-099-C", experiment_type: "盐雾" },
            ],
          }),
        });
      }
      return Promise.reject(new Error(`unexpected url: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.text()).toContain("CJ-2026-099");
    expect(wrapper.text()).toContain("温度冲击 / 振动 / 盐雾");
    expect(wrapper.text()).not.toContain("设备要求");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({
        credentials: "include",
      }),
    );
  });

  test("opens the intake modal from the route hash, auto-fills task code, and submits a task", async () => {
    setStorage(TASKS_KEY, [
      {
        id: "task-1",
        code: "SYLU-2026-03-001",
        name: "冲击试验-批次A",
        source: "外部委托",
        priority: "高",
        sample_count: 12,
        sample_type: "结构件",
        test_type: "冲击试验",
        due_at: "2026-03-13 18:00",
        arrival_at: "2026-03-13 12:00",
        status: "待排程",
        created_at: "2026-03-13T08:00:00.000Z",
      },
    ]);
    setStorage(SAMPLES_KEY, []);
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);

    await wrapper.get('select[name="test_type"]').setValue("冲击试验");

    const codeInput = wrapper.get('input[name="code"]');

    expect(codeInput.element.value).toBe("SYLU-2026-03-002");
    expect(wrapper.find('input[name="required_device"]').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("必需设备/能力");

    await wrapper.get('input[name="name"]').setValue("冲击试验-批次B");
    await wrapper.get('input[name="sample_count"]').setValue("3");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    const tasks = getStorage(TASKS_KEY);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        code: "SYLU-2026-03-002",
        name: "冲击试验-批次B",
      }),
    );
  });

  test("shows arrival time as a read-only field in intake and edit forms", async () => {
    setStorage(TASKS_KEY, [
      {
        id: "task-1",
        code: "CJ-2026-001",
        name: "冲击试验-批次A",
        source: "外部委托",
        priority: "高",
        sample_count: 2,
        sample_type: "结构件",
        test_type: "冲击试验",
        required_device: "冲击试验",
        arrival_at: "2026-03-18 08:00",
        status: "待排程",
        created_at: "2026-03-18T08:00:00.000Z",
      },
    ]);
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
    window.location.hash = "#task-intake-modal";
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/tasks" && !options.method) {
        return Promise.resolve({
          ok: true,
          json: async () => [],
        });
      }
      if (url === "/api/storage" && !options.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            [SCHEDULES_KEY]: [],
            [SAMPLES_KEY]: [],
            [STREAMS_KEY]: [],
          }),
        });
      }
      if (url === "/api/tasks" && options.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => JSON.parse(options.body),
        });
      }
      if (url === "/api/storage" && options.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true }),
        });
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('select[name="test_type"]').setValue("冲击试验");
    await wrapper.get('input[name="name"]').setValue("冲击试验-批次C");
    await wrapper.get('input[name="sample_count"]').setValue("2");
    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/tasks",
      expect.objectContaining({
        method: "POST",
      }),
    );

    const storageWriteCall = fetchMock.mock.calls.find(
      ([url, options]) => url === "/api/storage" && options?.method === "PUT",
    );
    expect(storageWriteCall).toBeTruthy();
    expect(JSON.parse(storageWriteCall[1].body)).toEqual({
      [SAMPLES_KEY]: expect.any(Array),
    });
  });

  test("creates a random task when the intake form is submitted with all default empty values", async () => {
    setStorage(TASKS_KEY, []);
    setStorage(SAMPLES_KEY, []);
    window.location.hash = "#task-intake-modal";

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.get('select[name="source"]').element.value).toBe("内部新增");

    await wrapper.get('[data-testid="task-submit"]').trigger("click");
    await settle(wrapper);

    const tasks = getStorage(TASKS_KEY);

    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toEqual(
      expect.objectContaining({
        code: expect.stringMatching(/^SYLU-\d{4}-\d{2}-\d{3}$/),
        name: expect.any(String),
        source: "内部新增",
        test_type: expect.any(String),
        status: expect.any(String),
      }),
    );
    expect(tasks[0].name.trim().length).toBeGreaterThan(0);
    expect(tasks[0].test_type.trim().length).toBeGreaterThan(0);
  });

  test("deletes a task and cascades related schedules, samples, and streams", async () => {
    setStorage(TASKS_KEY, [
      {
        id: "task-1",
        code: "CJ-2026-001",
        name: "冲击试验-批次A",
        source: "外部委托",
        priority: "高",
        sample_count: 2,
        sample_type: "结构件",
        test_type: "冲击试验",
        required_device: "冲击试验",
        due_at: "2026-03-13 18:00",
        arrival_at: "2026-03-13 12:00",
        status: "待排程",
        created_at: "2026-03-13T08:00:00.000Z",
      },
    ]);
    setStorage(SCHEDULES_KEY, [
      { id: "schedule-1", task_code: "CJ-2026-001", device: "冲击一室", start_at: "2026-03-13 12:00", end_at: "2026-03-13 14:00" },
    ]);
    setStorage(SAMPLES_KEY, [
      { id: "sample-1", code: "CJ-2026-001-SP-001", task_code: "CJ-2026-001" },
    ]);
    setStorage(STREAMS_KEY, [
      { id: "stream-1", task_code: "CJ-2026-001" },
    ]);

    let deleted = false;
    const fetchMock = vi.fn((url, options = {}) => {
      if (url === "/api/tasks" && !options.method) {
        return Promise.resolve({
          ok: true,
          json: async () => (deleted ? [] : getStorage(TASKS_KEY)),
        });
      }
      if (url === "/api/tasks/task-1" && options.method === "DELETE") {
        deleted = true;
        return Promise.resolve({
          ok: true,
          status: 204,
        });
      }
      if (url === "/api/storage" && options.method === "PUT") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ ok: true }),
        });
      }
      if (url === "/api/storage" && !options.method) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            [SCHEDULES_KEY]: getStorage(SCHEDULES_KEY),
            [SAMPLES_KEY]: getStorage(SAMPLES_KEY),
            [STREAMS_KEY]: getStorage(STREAMS_KEY),
            [EXPERIMENTS_KEY]: [],
          }),
        });
      }
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    await wrapper.get('[data-testid="open-task-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="task-delete"]').trigger("click");
    await settle(wrapper);

    expect(getStorage(TASKS_KEY)).toHaveLength(0);
    expect(getStorage(SCHEDULES_KEY)).toHaveLength(0);
    expect(getStorage(SAMPLES_KEY)).toHaveLength(0);
    expect(getStorage(STREAMS_KEY)).toHaveLength(0);
  });

  test("opens the intake modal when vue-router updates the route hash on the same page", async () => {
    setStorage(TASKS_KEY, []);

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(false);

    routeState.hash = "#task-intake-modal";
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
  });

  test("opens the intake modal when the app header dispatches the open-task event", async () => {
    setStorage(TASKS_KEY, []);

    const wrapper = mount(TasksPage);
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(false);

    window.dispatchEvent(new CustomEvent("mes:open-task-intake"));
    await settle(wrapper);

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
  });

  test("sample update event reloads tasks and refreshes the open drawer arrival time", async () => {
    let taskLoadCount = 0;
    const fetchMock = vi.fn((url) => {
      if (url === "/api/tasks") {
        taskLoadCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () =>
            taskLoadCount === 1
              ? [
                  {
                    id: "task-1",
                    code: "CJ-2026-001",
                    name: "冲击试验-批次A",
                    source: "外部委托",
                    priority: "高",
                    sample_count: 2,
                    sample_type: "结构件",
                    test_type: "冲击试验",
                    required_device: "冲击试验",
                    arrival_at: "",
                    status: "待排程",
                    created_at: "2026-03-18T08:00:00.000Z",
                  },
                ]
              : [
                  {
                    id: "task-1",
                    code: "CJ-2026-001",
                    name: "冲击试验-批次A",
                    source: "外部委托",
                    priority: "高",
                    sample_count: 2,
                    sample_type: "结构件",
                    test_type: "冲击试验",
                    required_device: "冲击试验",
                    arrival_at: "2026-03-18 09:14:45",
                    status: "待排程",
                    created_at: "2026-03-18T08:00:00.000Z",
                  },
                ],
        });
      }
      if (url === "/api/storage") {
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
