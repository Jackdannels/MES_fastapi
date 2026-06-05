import { mount } from "@vue/test-utils";
import { describe, expect, test, vi } from "vitest";

import TrayManagementPanel from "./TrayManagementPanel.vue";

const buildSamplesFlow = (overrides = {}) => ({
  rawExperimentTrays: [],
  rawExperiments: [],
  rawExperimentRuns: [],
  rawSamples: [],
  rawSchedules: [],
  rawTasks: [],
  trayRows: [],
  trayStatusOptions: [],
  updateTrayStatusInline: vi.fn(async () => {}),
  warning: "",
  clearWarning: vi.fn(),
  ...overrides,
});

describe("TrayManagementPanel", () => {
  test("renders tray table without task info/current status columns and collapses long sample code lists", () => {
    const wrapper = mount(TrayManagementPanel, {
      props: {
        samplesFlow: {
          rawExperimentTrays: [],
          rawExperiments: [],
          rawSamples: [],
          rawSchedules: [],
          rawTasks: [],
          trayRows: [
            {
              sampleCodes: [
                "SYLU-2026-03-021-SP-001",
                "SYLU-2026-03-021-SP-002",
                "SYLU-2026-03-021-SP-003",
                "SYLU-2026-03-021-SP-004",
                "SYLU-2026-03-021-SP-005",
                "SYLU-2026-03-021-SP-006",
              ],
              sampleCount: 6,
              sampleSummary:
                "SYLU-2026-03-021-SP-001、SYLU-2026-03-021-SP-002、SYLU-2026-03-021-SP-003、SYLU-2026-03-021-SP-004、SYLU-2026-03-021-SP-005、SYLU-2026-03-021-SP-006",
              status: "送至实验室",
              taskCode: "SYLU-2026-03-021",
              taskName: "不显示的任务名称",
              testType: "不显示的试验类型",
              trayCode: "SYLU-2026-03-021-TP-001",
            },
          ],
          trayStatusOptions: ["送至实验室"],
          updateTrayStatusInline: vi.fn(async () => {}),
          warning: "",
        },
      },
    });

    const headerText = wrapper.find("thead").text();
    expect(headerText).not.toContain("任务信息");
    expect(headerText).toContain("当前状态");

    expect(wrapper.find('[data-testid="samples-trays-task-0"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="samples-trays-status-display-0"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="samples-trays-status-0"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="samples-trays-current-status-0"]').text()).toBe("送至实验室");

    expect(wrapper.get('[data-testid="samples-trays-task-code-0"]').findAll(".tray-code-line").map((node) => node.text())).toEqual([
      "SYLU-2026-03-021",
    ]);
    expect(wrapper.get('[data-testid="samples-trays-tray-code-0"]').findAll(".tray-code-line").map((node) => node.text())).toEqual([
      "SYLU-2026-03-021-TP-001",
    ]);

    const visibleSamples = wrapper.get('[data-testid="samples-trays-sample-codes-0"]').findAll(".tray-sample-line").map((node) => node.text());
    expect(visibleSamples).toEqual([
      "SYLU-2026-03-021-SP-001",
      "SYLU-2026-03-021-SP-002",
      "SYLU-2026-03-021-SP-003",
      "SYLU-2026-03-021-SP-004",
      "...",
    ]);
    expect(wrapper.get('[data-testid="samples-trays-sample-popover-0"]').findAll(".tray-sample-popover-line").map((node) => node.text())).toEqual([
      "SYLU-2026-03-021-SP-001",
      "SYLU-2026-03-021-SP-002",
      "SYLU-2026-03-021-SP-003",
      "SYLU-2026-03-021-SP-004",
      "SYLU-2026-03-021-SP-005",
      "SYLU-2026-03-021-SP-006",
    ]);
  });

  test("paginates tray rows to five per page", async () => {
    const trayRows = Array.from({ length: 6 }, (_, index) => ({
      sampleCodes: [`SP-${index + 1}`],
      sampleCount: 1,
      sampleSummary: `SP-${index + 1}`,
      status: "送至实验室",
      taskCode: "SYLU-2026-05-001",
      trayCode: `SYLU-2026-05-001-TP-${String(index + 1).padStart(3, "0")}`,
    }));
    const wrapper = mount(TrayManagementPanel, {
      props: {
        samplesFlow: buildSamplesFlow({ trayRows }),
      },
    });

    expect(wrapper.findAll('[data-testid^="samples-trays-row-"]')).toHaveLength(5);
    expect(wrapper.text()).toContain("SYLU-2026-05-001-TP-005");
    expect(wrapper.text()).not.toContain("SYLU-2026-05-001-TP-006");
    expect(wrapper.get('[data-testid="pagination-status"]').text()).toContain("第 1 / 2 页");

    await wrapper.get('[data-page="next"]').trigger("click");
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('[data-testid^="samples-trays-row-"]')).toHaveLength(1);
    expect(wrapper.text()).toContain("SYLU-2026-05-001-TP-006");
  });

  test("keeps only the unified tray flow title above the tray flow", () => {
    const wrapper = mount(TrayManagementPanel, {
      props: {
        samplesFlow: buildSamplesFlow({
          rawExperimentTrays: [
            {
              task_code: "TASK-001",
              experiment_code: "TASK-001-A",
              tray_code: "TP-001",
            },
          ],
          rawExperiments: [
            {
              task_code: "TASK-001",
              experiment_code: "TASK-001-A",
              experiment_type: "霉菌试验",
            },
          ],
          rawSamples: [
            {
              code: "SP-001",
              task_code: "TASK-001",
              location: "霉菌试验室",
              status: "送至实验室",
              owner: "张三",
              trays: [{ tray_code: "TP-001", status: "送至实验室" }],
            },
          ],
          rawSchedules: [
            {
              task_code: "TASK-001",
              experimentCode: "TASK-001-A",
              device: "霉菌试验室",
            },
          ],
          trayRows: [
            {
              sampleCodes: ["SP-001", "SP-002"],
              sampleCount: 2,
              sampleSummary: "SP-001、SP-002",
              status: "送至实验室",
              taskCode: "TASK-001",
              trayCode: "TP-001",
            },
          ],
        }),
      },
    });

    const trayFlowCard = wrapper.get('[data-testid="samples-tray-flow"]').text();
    expect(trayFlowCard).toContain("统一托盘流程图");
    expect(trayFlowCard).toContain("送至霉菌试验室");
    expect(trayFlowCard).not.toContain("当前托盘");
    expect(trayFlowCard).not.toContain("当前位置");
    expect(trayFlowCard).not.toContain("责任人");
    expect(trayFlowCard).not.toContain("样品：");
  });

  test("shows partial experiment completion as running with a completed-count suffix in the task flow", async () => {
    const wrapper = mount(TrayManagementPanel, {
      props: {
        samplesFlow: {
          rawExperimentTrays: [],
          rawExperiments: [
            { task_code: "SYLU-2026-03-021", experiment_code: "SYLU-2026-03-021-A", experiment_name: "冲击试验", status: "实验已经完成" },
            { task_code: "SYLU-2026-03-021", experiment_code: "SYLU-2026-03-021-B", experiment_name: "振动试验", status: "待排程" },
          ],
          rawSamples: [],
          rawSchedules: [],
          rawTasks: [{ code: "SYLU-2026-03-021", status: "已排程" }],
          trayRows: [
            {
              sampleCount: 1,
              sampleSummary: "SYLU-2026-03-021-SP-001",
              status: "实验进行中",
              taskCode: "SYLU-2026-03-021",
              taskName: "部分完成任务",
              testType: "冲击试验 / 振动试验",
              trayCode: "SYLU-2026-03-021-TP-001",
            },
          ],
          trayStatusOptions: ["实验进行中", "实验已完成"],
          updateTrayStatusInline: vi.fn(async () => {}),
          warning: "",
        },
      },
    });

    expect(wrapper.get('[data-testid="samples-task-flow-status"]').text()).toBe("任务进行中（已完成1个实验）");
  });

  test("shows times on the right side of the unified tray flow", () => {
    const wrapper = mount(TrayManagementPanel, {
      props: {
        samplesFlow: {
          rawExperimentTrays: [],
          rawExperiments: [],
          rawSamples: [
            {
              code: "SYLU-2026-03-021-SP-001",
              task_code: "SYLU-2026-03-021",
              status: "厂家收回",
              trays: [{ tray_code: "SYLU-2026-03-021-TP-001", status: "厂家收回", quantity: 1 }],
              history: [
                { action: "批量入库", status: "到货", time: "2026-04-28T11:31:20+08:00" },
                { action: "厂家收回", status: "厂家收回", detail: "SYLU-2026-03-021-TP-001 厂家收回", time: "2026-04-28T11:36:00+08:00" },
              ],
            },
          ],
          rawSchedules: [],
          rawTasks: [{ code: "SYLU-2026-03-021", status: "厂家收回" }],
          trayRows: [
            {
              sampleCodes: ["SYLU-2026-03-021-SP-001"],
              sampleCount: 1,
              sampleSummary: "SYLU-2026-03-021-SP-001",
              status: "厂家收回",
              taskCode: "SYLU-2026-03-021",
              trayCode: "SYLU-2026-03-021-TP-001",
            },
          ],
          trayStatusOptions: ["厂家收回"],
          updateTrayStatusInline: vi.fn(async () => {}),
          warning: "",
        },
      },
    });

    expect(wrapper.get('[data-testid="samples-tray-flow-step-arrived"]').text()).toContain("2026-04-28 11:31:20");
    expect(wrapper.get('[data-testid="samples-tray-flow-step-returned"]').text()).toContain("2026-04-28 11:36:00");
  });

  test("uses experiment runs in the unified tray flow for running experiment time", () => {
    const wrapper = mount(TrayManagementPanel, {
      props: {
        samplesFlow: buildSamplesFlow({
          rawExperimentRuns: [
            {
              task_code: "SYLU-2026-06-021",
              experiment_code: "SYLU-2026-06-021-A",
              tray_codes: ["SYLU-2026-06-021-TP-001"],
              status: "实验进行中",
              started_at: "2026-06-04T19:12:09+08:00",
            },
          ],
          rawExperimentTrays: [
            { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-001" },
            { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-B", tray_code: "SYLU-2026-06-021-TP-001" },
          ],
          rawExperiments: [
            {
              task_code: "SYLU-2026-06-021",
              experiment_code: "SYLU-2026-06-021-A",
              experiment_name: "冲击试验",
              required_device: "冲击试验",
              status: "实验进行中",
            },
            {
              task_code: "SYLU-2026-06-021",
              experiment_code: "SYLU-2026-06-021-B",
              experiment_name: "温度冲击试验",
              required_device: "温度冲击试验",
              status: "已排程",
            },
          ],
          rawSamples: [
            {
              code: "SYLU-2026-06-021-SP-001",
              task_code: "SYLU-2026-06-021",
              location: "冲击一室",
              status: "实验进行中",
              trays: [
                {
                  tray_code: "SYLU-2026-06-021-TP-001",
                  sample_code: "SYLU-2026-06-021-SP-001",
                  quantity: 1,
                  status: "实验进行中",
                  target_lab: "冲击一室",
                },
              ],
              history: [
                {
                  action: "实验确认",
                  detail: "SYLU-2026-06-021 / 冲击试验 / 实验准备就绪",
                  location: "冲击一室",
                  status: "实验准备就绪",
                  time: "2026-06-04T19:12:07+08:00",
                },
              ],
            },
          ],
          rawSchedules: [
            { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", device: "冲击一室", status: "实验进行中" },
          ],
          rawTasks: [{ code: "SYLU-2026-06-021", status: "任务进行中" }],
          trayRows: [
            {
              sampleCodes: ["SYLU-2026-06-021-SP-001"],
              sampleCount: 1,
              sampleSummary: "SYLU-2026-06-021-SP-001",
              status: "实验进行中",
              taskCode: "SYLU-2026-06-021",
              trayCode: "SYLU-2026-06-021-TP-001",
            },
          ],
        }),
      },
    });

    const runningStep = wrapper.get('[data-testid="samples-tray-flow-step-experiment-current-0"]');
    expect(runningStep.text()).toContain("冲击试验进行中");
    expect(runningStep.text()).toContain("2026-06-04 19:12:09");
  });
});
