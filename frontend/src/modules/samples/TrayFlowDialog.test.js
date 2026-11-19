import { mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";

import TrayFlowDialog from "./TrayFlowDialog.vue";
import { buildTrayFlowView } from "./samplesFlowModel";
import { buildSampleTaskFlow } from "./sampleFlow.taskFlow";

const trayProps = (data) => {
  const tray = data.trayRows[0];
  return {
    open: true,
    trayCode: tray.trayCode,
    flow: buildTrayFlowView({
      taskCode: tray.taskCode,
      trayCode: tray.trayCode,
      status: tray.status,
      samples: data.rawSamples,
      schedules: data.rawSchedules,
      experiments: data.rawExperiments,
      experimentTrays: data.rawExperimentTrays,
      experimentRuns: data.rawExperimentRuns,
      experimentRunTrays: data.rawExperimentRunTrays,
      experimentRunPauses: data.rawExperimentRunPauses,
      stagingEvents: data.rawStagingEvents,
    }),
  };
};
const mountTrayFlow = (data) => mount(TrayFlowDialog, { props: trayProps(data) });

describe("TrayFlowDialog", () => {
  test("shows the exact arrival room and uses green history for a canceled experiment", () => {
    const taskCode = "T-ARRIVAL", trayCode = "T-ARRIVAL-TP-001";
    const samplesFlow = {
      rawExperiments: [
        { task_code: taskCode, experiment_code: "E", experiment_name: "四综合试验", status: "待排程" },
        { task_code: taskCode, experiment_code: "NEXT", experiment_name: "盐雾试验", status: "已排程" },
      ],
      rawExperimentTrays: ["E", "NEXT"].map((experiment_code) => ({ task_code: taskCode, experiment_code, tray_code: trayCode })),
      rawExperimentRuns: [{ run_no: "OLD", task_code: taskCode, experiment_code: "E", device: "四综合实验室", status: "设备故障试验取消", started_at: "2099-09-15 08:00:00", ended_at: "2099-09-15 09:00:00" }],
      rawExperimentRunTrays: [{ run_no: "OLD", task_code: taskCode, experiment_code: "E", tray_code: trayCode, run_tray_status: "设备故障试验取消", ended_at: "2099-09-15 09:00:00" }],
      rawSchedules: [{ id: "S2", task_code: taskCode, experiment_code: "NEXT", device: "盐雾试验室", start_at: "2099-09-15 10:00:00", status: "已排程" }],
      rawSamples: [{ code: "SP", task_code: taskCode, location: "盐雾试验室", status: "工装夹具安装", flow_status: "工装夹具安装",
        trays: [{ tray_code: trayCode, quantity: 1, status: "工装夹具安装" }],
        history: [
          { status: "已到达实验室", location: "盐雾试验室", time: "2099-09-15 10:00:00", detail: `${taskCode} / 盐雾试验 / 已到达实验室` },
          { status: "工装夹具安装", location: "盐雾试验室", time: "2099-09-15 10:01:00", detail: `${taskCode} / 盐雾试验 / 工装夹具安装` },
        ],
      }],
      trayRows: [{ taskCode, trayCode, status: "工装夹具安装", sampleCount: 1, sampleCodes: ["SP"] }],
    };
    const wrapper = mountTrayFlow(samplesFlow);
    expect(wrapper.text()).toContain("已到达盐雾试验室");
    const canceled = wrapper.get('[data-testid="samples-tray-flow-step-device-fault-canceled-OLD"]');
    expect(canceled.classes()).toContain("reached");
    expect(canceled.classes()).not.toContain("fault-canceled");
    expect(canceled.text()).toContain("设备故障试验取消");
    for (const label of ["送至暂存间", "已到达暂存间"]) {
      const inferred = wrapper.findAll(".sample-flow-unified--timed li").find((node) => node.get(".sample-flow-label").text() === label);
      expect(inferred.classes()).toContain("reached");
      expect(inferred.classes()).not.toContain("current");
      expect(inferred.get(".sample-flow-time").text()).toBe("-");
      expect(inferred.attributes("title")).toBe("推导节点，暂无实际时间记录");
    }
    wrapper.unmount();
  });
  test("shows the salt-spray pause remark without replacing the tray flow status", async () => {
    const taskCode = "TASK-SALT-PAUSED";
    const experimentCode = "EXP-SALT-PAUSED";
    const trayCode = "TP-SALT-PAUSED";
    const pausedFlow = {
      rawExperiments: [{ task_code: taskCode, experiment_code: experimentCode, experiment_name: "盐雾试验" }],
      rawExperimentRunPauses: [{ lab_code: "LAB_SALT", pause_no: "PAUSE-1", run_no: "RUN-1", status: "实验暂停" }],
      rawExperimentRuns: [{ experiment_code: experimentCode, run_no: "RUN-1", status: "实验暂停", task_code: taskCode }],
      rawExperimentRunTrays: [{ experiment_code: experimentCode, run_no: "RUN-1", run_tray_status: "实验进行中", task_code: taskCode, tray_code: trayCode }],
      rawExperimentTrays: [{ experiment_code: experimentCode, task_code: taskCode, tray_code: trayCode }],
      rawSamples: [{
        code: "SP-SALT-PAUSED",
        flow_status: "中途外观检查中",
        location: "外观检测间",
        status: "中途外观检查中",
        task_code: taskCode,
        trays: [{ quantity: 1, status: "中途外观检查中", tray_code: trayCode }],
      }],
      rawStagingEvents: [{
        action: "stock_in",
        appearance_phase: "mid_experiment",
        pause_no: "PAUSE-1",
        room: "appearance",
        run_no: "RUN-1",
        time: "2026-09-04 14:30:00",
        tray_code: trayCode,
      }],
      trayRows: [{ sampleCodes: ["SP-SALT-PAUSED"], sampleCount: 1, status: "中途外观检查中", taskCode, trayCode }],
    };
    const wrapper = mountTrayFlow(pausedFlow);

    expect(wrapper.get('[data-testid="samples-tray-flow-remark"]').text())
      .toBe("备注：实验进行中（暂停）");
    expect(wrapper.text()).toContain("盐雾试验进行中（暂停）");
    expect(wrapper.text()).toContain("中途外观检测");

    await wrapper.setProps({
      ...trayProps({
        ...pausedFlow,
        rawExperimentRunPauses: [{
          lab_code: "LAB_SALT",
          pause_no: "PAUSE-1",
          resumed_at: "2026-09-02 10:10:00",
          run_no: "RUN-1",
          status: "实验已恢复",
        }],
        rawExperimentRuns: [{ experiment_code: experimentCode, run_no: "RUN-1", status: "实验进行中", task_code: taskCode }],
      }),
    });

    expect(wrapper.find('[data-testid="samples-tray-flow-remark"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("盐雾试验进行中");
    expect(wrapper.text()).not.toContain("盐雾试验进行中（暂停）");
  });

  test("keeps only the unified tray flow title above the tray flow", () => {
    const wrapper = mountTrayFlow({
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
    });

    const trayFlowCard = wrapper.get('[data-testid="sample-tray-flow-dialog"]').text();
    expect(trayFlowCard).toContain("统一托盘流程图");
    expect(trayFlowCard).toContain("送至霉菌试验室");
    expect(trayFlowCard).not.toContain("当前托盘");
    expect(trayFlowCard).not.toContain("当前位置");
    expect(trayFlowCard).not.toContain("责任人");
    expect(trayFlowCard).not.toContain("样品：");
  });

  test("summarizes partial task completion shared by the sample views", () => {
    const flow = buildSampleTaskFlow({
      taskCode: "T",
      tasks: [{ code: "T", status: "已排程" }],
      experiments: [
        { task_code: "T", experiment_code: "E1", status: "实验已经完成" },
        { task_code: "T", experiment_code: "E2", status: "待排程" },
      ],
    });
    expect(flow.currentStatus).toBe("任务进行中（已完成1个实验）");
  });

  test("shows times on the right side of the unified tray flow", () => {
    const wrapper = mountTrayFlow({
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
    });

    expect(wrapper.get('[data-testid="samples-tray-flow-step-arrived"]').text()).toContain("2026-04-28 11:31:20");
    expect(wrapper.get('[data-testid="samples-tray-flow-step-returned"]').text()).toContain("2026-04-28 11:36:00");
  });

  test("uses experiment runs in the unified tray flow for running experiment time", () => {
    const wrapper = mountTrayFlow({
      rawExperimentRuns: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          tray_codes: ["SYLU-2026-06-021-TP-001"],
          status: "实验进行中",
          started_at: "2026-06-04T19:12:09+08:00",
        },
      ],
      rawExperimentRunTrays: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          run_no: "RUN-SYLU-2026-06-021-A",
          tray_code: "SYLU-2026-06-021-TP-001",
          run_tray_status: "实验进行中",
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
    });

    const runningStep = wrapper.get('[data-testid="samples-tray-flow-step-experiment-current-0"]');
    expect(runningStep.text()).toContain("冲击试验进行中");
    expect(runningStep.text()).toContain("2026-06-04 19:12:09");
  });
});
