import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { SNAPSHOT_UPDATED_EVENT } from "@/lib/storageApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";
import { useLaboratoryPage } from "./useLaboratoryPage";

vi.mock("@/lib/masterDataApi", () => ({
  readMasterLabs: vi.fn(async () => []),
}));

vi.mock("@/lib/attendanceApi", () => ({
  loginLaboratoryAttendance: vi.fn(async () => ({ active: true })),
  logoutLaboratoryAttendance: vi.fn(async () => ({ active: false })),
  markLaboratoryAttendanceWorkStarted: vi.fn(async () => ({ active: true })),
  readLaboratoryAttendanceSession: vi.fn(async (labName) => ({ active: false, labName })),
}));

const flushPromises = async (cycles = 4) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
};

const createSnapshot = () => ({
  [STORAGE_KEYS.tasks]: [{ code: "TASK-LAB-001", name: "盐雾任务", test_type: "盐雾试验" }],
  [STORAGE_KEYS.schedules]: [
    {
      id: "schedule-lab-001",
      task_code: "TASK-LAB-001",
      experiment_code: "EXP-LAB-001",
      device: "盐雾试验室",
      start_at: "2026-04-02T09:30:00.000Z",
      end_at: "2026-04-02T11:00:00.000Z",
    },
  ],
  [STORAGE_KEYS.experiments]: [
    { task_code: "TASK-LAB-001", experiment_code: "EXP-LAB-001", experiment_name: "盐雾试验" },
  ],
  [STORAGE_KEYS.experiment_runs]: [],
  [STORAGE_KEYS.experiment_run_trays]: [],
  [STORAGE_KEYS.experiment_trays]: [
    { task_code: "TASK-LAB-001", experiment_code: "EXP-LAB-001", tray_code: "TRAY-LAB-001" },
  ],
  [STORAGE_KEYS.samples]: [
    {
      code: "SAMPLE-LAB-001",
      location: "盐雾试验室",
      status: "送至实验室",
      task_code: "TASK-LAB-001",
      trays: [{ quantity: 1, status: "送至实验室", tray_code: "TRAY-LAB-001" }],
    },
  ],
  [STORAGE_KEYS.devices]: [],
});

const createTwoTaskSnapshot = () => {
  const snapshot = createSnapshot();
  snapshot[STORAGE_KEYS.tasks] = [
    ...snapshot[STORAGE_KEYS.tasks],
    { code: "TASK-LAB-002", name: "盐雾任务二", test_type: "盐雾试验" },
  ];
  snapshot[STORAGE_KEYS.schedules] = [
    ...snapshot[STORAGE_KEYS.schedules],
    {
      id: "schedule-lab-002",
      task_code: "TASK-LAB-002",
      experiment_code: "EXP-LAB-002",
      device: "盐雾试验室",
      start_at: "2026-04-02T12:00:00.000Z",
      end_at: "2026-04-02T13:00:00.000Z",
    },
  ];
  snapshot[STORAGE_KEYS.experiments] = [
    ...snapshot[STORAGE_KEYS.experiments],
    { task_code: "TASK-LAB-002", experiment_code: "EXP-LAB-002", experiment_name: "盐雾试验二" },
  ];
  snapshot[STORAGE_KEYS.experiment_trays] = [
    ...snapshot[STORAGE_KEYS.experiment_trays],
    { task_code: "TASK-LAB-002", experiment_code: "EXP-LAB-002", tray_code: "TRAY-LAB-002" },
  ];
  snapshot[STORAGE_KEYS.samples] = [
    {
      code: "SAMPLE-LAB-001",
      location: "盐雾试验室",
      status: "工装夹具安装",
      flow_status: "工装夹具安装",
      task_code: "TASK-LAB-001",
      trays: [{ quantity: 1, status: "工装夹具安装", tray_code: "TRAY-LAB-001" }],
    },
    {
      code: "SAMPLE-LAB-002",
      location: "盐雾试验室",
      status: "送至实验室",
      flow_status: "送至实验室",
      task_code: "TASK-LAB-002",
      trays: [{ quantity: 1, status: "送至实验室", tray_code: "TRAY-LAB-002" }],
    },
  ];
  return snapshot;
};

const createSameTaskAxisScheduleSnapshot = () => {
  const snapshot = createSnapshot();
  snapshot[STORAGE_KEYS.tasks] = [
    { code: "TASK-LAB-001", name: "冲击任务", test_type: "冲击试验" },
  ];
  snapshot[STORAGE_KEYS.schedules] = [
    {
      id: "schedule-lab-axis-x",
      task_code: "TASK-LAB-001",
      experiment_code: "EXP-LAB-001",
      sub_experiment_code: "EXP-LAB-001-A",
      axis_codes: ["X"],
      device: "盐雾试验室",
      start_at: "2026-04-02T09:30:00.000Z",
      end_at: "2026-04-02T11:00:00.000Z",
    },
    {
      id: "schedule-lab-axis-y",
      task_code: "TASK-LAB-001",
      experiment_code: "EXP-LAB-001",
      sub_experiment_code: "EXP-LAB-001-B",
      axis_codes: ["Y"],
      device: "盐雾试验室",
      start_at: "2026-04-02T12:00:00.000Z",
      end_at: "2026-04-02T13:00:00.000Z",
    },
  ];
  snapshot[STORAGE_KEYS.experiments] = [
    {
      task_code: "TASK-LAB-001",
      experiment_code: "EXP-LAB-001",
      experiment_name: "冲击试验",
      axis_codes: ["X", "Y"],
    },
  ];
  snapshot[STORAGE_KEYS.samples] = [
    {
      code: "SAMPLE-LAB-001",
      location: "盐雾试验室",
      status: "已到达实验室",
      flow_status: "已到达实验室",
      task_code: "TASK-LAB-001",
      trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TRAY-LAB-001" }],
    },
  ];
  return snapshot;
};

const mountLaboratoryHook = async ({ loadSnapshot }) => {
  let exposed;
  const TestHost = defineComponent({
    setup() {
      exposed = useLaboratoryPage({
        loadSnapshot,
        now: new Date("2026-04-02T10:00:00.000Z"),
      });
      return () => null;
    },
  });
  const wrapper = mount(TestHost);
  await flushPromises();
  return { exposed, wrapper };
};

describe("useLaboratoryPage realtime refresh", () => {
  beforeEach(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        clear: vi.fn(),
        getItem: vi.fn(() => null),
        removeItem: vi.fn(),
        setItem: vi.fn(),
      },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test("keeps existing laboratory rows visible and loading false during samples-updated refresh", async () => {
    let resolveRefresh;
    const loadSnapshot = vi
      .fn()
      .mockResolvedValueOnce(createSnapshot())
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveRefresh = resolve;
      }));
    const { exposed, wrapper } = await mountLaboratoryHook({ loadSnapshot });

    expect(exposed.loading.value).toBe(false);
    expect(exposed.recentTasks.value.map((row) => row.taskCode)).toEqual(["TASK-LAB-001"]);

    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await flushPromises(1);

    expect(loadSnapshot).toHaveBeenCalledTimes(2);
    expect(exposed.loading.value).toBe(false);
    expect(exposed.recentTasks.value.map((row) => row.taskCode)).toEqual(["TASK-LAB-001"]);

    resolveRefresh(createSnapshot());
    await flushPromises();
    wrapper.unmount();
  });

  test("preserves existing arrays when storage refresh omits keys but accepts real empty arrays", async () => {
    vi.useFakeTimers();
    const fullSnapshot = createSnapshot();
    const loadSnapshot = vi
      .fn()
      .mockResolvedValueOnce(fullSnapshot)
      .mockResolvedValueOnce({
        [STORAGE_KEYS.tasks]: "not-an-array",
      })
      .mockResolvedValueOnce({
        [STORAGE_KEYS.tasks]: [],
        [STORAGE_KEYS.schedules]: [],
        [STORAGE_KEYS.experiments]: [],
        [STORAGE_KEYS.experiment_runs]: [],
        [STORAGE_KEYS.experiment_run_trays]: [],
        [STORAGE_KEYS.experiment_trays]: [],
        [STORAGE_KEYS.samples]: [],
        [STORAGE_KEYS.devices]: [],
      });
    const { exposed, wrapper } = await mountLaboratoryHook({ loadSnapshot });

    expect(exposed.recentTasks.value.map((row) => row.taskCode)).toEqual(["TASK-LAB-001"]);

    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: [STORAGE_KEYS.tasks] } }));
    vi.advanceTimersByTime(100);
    await flushPromises();

    expect(exposed.loading.value).toBe(false);
    expect(exposed.recentTasks.value.map((row) => row.taskCode)).toEqual(["TASK-LAB-001"]);

    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, { detail: { keys: [STORAGE_KEYS.tasks] } }));
    vi.advanceTimersByTime(100);
    await flushPromises();

    expect(exposed.recentTasks.value).toEqual([]);
    wrapper.unmount();
  });

  test("blocks switching viewed tasks after the current task reaches fixture installation", async () => {
    const loadSnapshot = vi.fn().mockResolvedValueOnce(createTwoTaskSnapshot());
    const { exposed, wrapper } = await mountLaboratoryHook({ loadSnapshot });

    expect(exposed.currentTask.value.taskCode).toBe("TASK-LAB-001");

    exposed.openTaskList();
    expect(exposed.pendingTaskCode.value).toBe("schedule-lab-001");

    exposed.setPendingTaskCode("schedule-lab-002");
    expect(exposed.pendingTaskCode.value).toBe("schedule-lab-001");

    exposed.confirmCurrentTask();
    await flushPromises();

    expect(exposed.currentTask.value.taskCode).toBe("TASK-LAB-001");
    wrapper.unmount();
  });

  test("blocks switching schedules within the same task after a tray is compared", async () => {
    const loadSnapshot = vi.fn().mockResolvedValueOnce(createSameTaskAxisScheduleSnapshot());
    const { exposed, wrapper } = await mountLaboratoryHook({ loadSnapshot });

    expect(exposed.currentTask.value.taskCode).toBe("TASK-LAB-001");
    expect(exposed.currentTask.value.id).toBe("schedule-lab-axis-x");

    exposed.openTaskList();
    expect(exposed.pendingTaskCode.value).toBe("schedule-lab-axis-x");

    exposed.setPendingTaskCode("schedule-lab-axis-y");
    expect(exposed.pendingTaskCode.value).toBe("schedule-lab-axis-x");

    exposed.confirmCurrentTask();
    await flushPromises();

    expect(exposed.currentTask.value.id).toBe("schedule-lab-axis-x");
    wrapper.unmount();
  });
});
