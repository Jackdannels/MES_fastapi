import { enableAutoUnmount, mount } from "@vue/test-utils";
import { defineComponent } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fullSnapshotReads: 0,
  readSampleDetail: vi.fn(),
  readSamplePage: vi.fn(),
  requestedKeys: [],
}));

vi.mock("@/lib/samplesApi.js", () => ({
  readSampleDetail: mocks.readSampleDetail,
  readSamplePage: mocks.readSamplePage,
}));

vi.mock("@/lib/tasksApi", () => ({
  readTasks: vi.fn(async () => [{ code: "TASK-001", name: "任务一" }]),
  updateTask: vi.fn(),
}));

vi.mock("@/composables/useStorageSnapshot", () => ({
  useStorageSnapshot: (keys) => {
    mocks.requestedKeys.push([...keys]);
    return {
      loadSnapshot: async () => {
        if (keys.length === 1 && keys[0] === "mes.samples") {
          mocks.fullSnapshotReads += 1;
          return {
            "mes.samples": [
              {
                id: "TASK-001-SP-001",
                code: "TASK-001-SP-001",
                task_code: "TASK-001",
                location: "恒温恒湿间（暂存间）",
                status: "已到达暂存间",
                trays: [{ tray_code: "TRAY-001", status: "已到达暂存间" }],
                history: [{ action: "stock_in" }],
              },
            ],
          };
        }
        return {
          "mes.experiments": [],
          "mes.experiment_runs": [],
          "mes.experiment_run_steps": [],
          "mes.experiment_run_trays": [],
          "mes.experiment_trays": [],
          "mes.schedules": [],
        };
      },
      persistSnapshot: vi.fn(),
    };
  },
}));

import { useSamplesFlow } from "./useSamplesFlow";

const Harness = defineComponent({
  setup: () => useSamplesFlow(),
  render: () => null,
});

const settle = async (wrapper) => {
  await Promise.resolve();
  await Promise.resolve();
  await wrapper.vm.$nextTick();
  await Promise.resolve();
};

describe("useSamplesFlow paged reads", () => {
  enableAutoUnmount(afterEach);

  beforeEach(() => {
    mocks.fullSnapshotReads = 0;
    mocks.requestedKeys.length = 0;
    mocks.readSampleDetail.mockReset();
    mocks.readSamplePage.mockReset();
    mocks.readSamplePage.mockImplementation(async (options) => {
      const staging = options.view === "staging";
      const sample = {
        id: staging ? "TASK-001-SP-STAGING" : "TASK-001-SP-001",
        code: staging ? "TASK-001-SP-STAGING" : "TASK-001-SP-001",
        task_code: "TASK-001",
        location: staging ? "恒温恒湿间（暂存间）" : "接驳区",
        status: staging ? "已到达暂存间" : "到货",
        flow_status: staging ? "已到达暂存间" : "到货",
        trayCodes: [staging ? "TRAY-STAGING" : "TRAY-001"],
      };
      return {
        currentPage: 1,
        samples: [sample],
        statusOptions: [sample.status],
        taskOptions: ["TASK-001"],
        totalCount: 1,
        totalPages: 1,
      };
    });
    mocks.readSampleDetail.mockResolvedValue({
      id: "TASK-001-SP-001",
      code: "TASK-001-SP-001",
      task_code: "TASK-001",
      status: "到货",
      trays: [{ tray_code: "TRAY-001", status: "到货" }],
      history: [{ action: "received" }],
    });
  });

  test("loads flow and staging summaries without an initial full sample snapshot", async () => {
    const wrapper = mount(Harness);
    await settle(wrapper);

    expect(mocks.readSamplePage).toHaveBeenCalledWith(expect.objectContaining({ pageSize: 8 }));
    expect(mocks.readSamplePage).toHaveBeenCalledWith(expect.objectContaining({ view: "staging" }));
    expect(wrapper.vm.sampleRows.map((row) => row.code)).toEqual(["TASK-001-SP-001"]);
    expect(wrapper.vm.stagingRows.map((row) => row.code)).toEqual(["TASK-001-SP-STAGING"]);
    expect(wrapper.vm.stagingCount).toBe(1);
    expect(mocks.fullSnapshotReads).toBe(0);
  });

  test("loads complete sample data only for detail or explicit full-view demand", async () => {
    const wrapper = mount(Harness);
    await settle(wrapper);

    await wrapper.vm.openDetailDrawer("TASK-001-SP-001");
    expect(mocks.readSampleDetail).toHaveBeenCalledWith("TASK-001-SP-001");
    expect(wrapper.vm.detailSample.history).toEqual([{ action: "received" }]);
    expect(mocks.fullSnapshotReads).toBe(0);

    await wrapper.vm.ensureFullSamples();
    expect(mocks.fullSnapshotReads).toBe(1);
    expect(wrapper.vm.rawSamples[0].history).toEqual([{ action: "stock_in" }]);
  });

  test("coalesces concurrent full-snapshot demand before a write action", async () => {
    const wrapper = mount(Harness);
    await settle(wrapper);

    await Promise.all([wrapper.vm.ensureFullSamples(), wrapper.vm.ensureFullSamples()]);

    expect(mocks.fullSnapshotReads).toBe(1);
  });
});
