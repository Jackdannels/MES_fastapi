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
});
