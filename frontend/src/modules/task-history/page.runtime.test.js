import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import TaskHistoryPage from "./page.vue";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { readTasks } from "@/lib/tasksApi";

const { refreshState, storageState } = vi.hoisted(() => ({
  refreshState: {
    registrations: [],
  },
  storageState: {
    snapshot: {},
  },
}));

vi.mock("@/lib/tasksApi", () => ({
  readTasks: vi.fn(),
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: () => ({
    loadSnapshot: vi.fn(() => storageState.snapshot),
  }),
}));

vi.mock("@/composables/useStorageSnapshotRefresh", () => ({
  useStorageSnapshotRefresh: vi.fn((options) => {
    refreshState.registrations.push(options);
    return {
      flushPendingRefresh: vi.fn(),
      hasPendingRefresh: { value: false },
      stop: vi.fn(),
    };
  }),
}));

let wrapper;

const returnedTasks = [
  {
    code: "TASK-HISTORY-KEEP",
    name: "历史保留任务",
    status: "厂家收回",
  },
];

const returnedSnapshot = {
  [STORAGE_KEYS.samples]: [
    {
      code: "SP-HISTORY-KEEP",
      task_code: "TASK-HISTORY-KEEP",
      status: "厂家收回",
      trays: [{ tray_code: "TP-HISTORY-KEEP", status: "厂家收回" }],
      history: [
        {
          detail: "TP-HISTORY-KEEP 厂家收回",
          status: "厂家收回",
          time: "2026-05-21T09:00:00+08:00",
        },
      ],
    },
  ],
  [STORAGE_KEYS.experiments]: [],
  [STORAGE_KEYS.experiment_runs]: [],
  [STORAGE_KEYS.experiment_run_trays]: [],
  [STORAGE_KEYS.experiment_trays]: [],
  [STORAGE_KEYS.schedules]: [],
};

const settlePage = async (target) => {
  for (let index = 0; index < 4; index += 1) {
    await Promise.resolve();
    await target.vm.$nextTick();
  }
};

const mountPage = async () => {
  wrapper = mount(TaskHistoryPage, { attachTo: document.body });
  await settlePage(wrapper);
  return wrapper;
};

describe("TaskHistoryPage runtime", () => {
  beforeEach(() => {
    refreshState.registrations = [];
    storageState.snapshot = returnedSnapshot;
    readTasks.mockResolvedValue(returnedTasks);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) => {
        if (String(url).includes("/api/storage")) {
          return { ok: true, json: async () => storageState.snapshot };
        }
        throw new Error(`Unhandled request: ${String(url)}`);
      }),
    );
  });

  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  test("keeps history rows and selected tray detail when a background refresh omits array snapshot keys", async () => {
    const mounted = await mountPage();

    expect(mounted.get('[data-testid="history-task-list"]').text()).toContain("TASK-HISTORY-KEEP");
    expect(mounted.get('[data-testid="history-task-detail"]').text()).toContain("TP-HISTORY-KEEP");

    storageState.snapshot = {
      [STORAGE_KEYS.samples]: "not-an-array",
    };
    await refreshState.registrations[0].refresh();
    await settlePage(mounted);

    expect(mounted.get('[data-testid="history-task-list"]').text()).toContain("TASK-HISTORY-KEEP");
    expect(mounted.get('[data-testid="history-task-detail"]').text()).toContain("TP-HISTORY-KEEP");
    expect(mounted.find('[data-testid="history-task-TASK-HISTORY-KEEP"]').classes()).toContain("active");
  });
});
