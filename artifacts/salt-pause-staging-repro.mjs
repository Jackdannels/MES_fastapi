import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "../frontend/node_modules/vite/dist/node/index.js";

// Read-only reproduction through the production flow model. No API writes.
const root = fileURLToPath(new URL("../frontend/", import.meta.url));
const server = await createServer({
  root,
  configFile: `${root}/vite.config.js`,
  server: { middlewareMode: true },
  appType: "custom",
});

try {
  const { buildTrayFlowView } = await server.ssrLoadModule("/src/modules/samples/sampleFlow.trayFlowView.js");
  const { buildTrayFlowEngine } = await server.ssrLoadModule("/src/modules/samples/sampleFlow.trayFlowEngine.js");
  const { resolveVisualFlowStepTone } = await server.ssrLoadModule("/src/modules/visualization/flowStepState.js");

  function snapshot({ paused = false, priorExperiment = true, explicitDispatch = false } = {}) {
    const task = "REPRO-SALT", tray = "REPRO-SALT-TP-002", salt = "SALT", prior = "FOUR";
    const time = (value) => `2026-11-12 ${value}`;
    const history = [
      { status: "到货", location: "接驳区", time: time("20:06:00") },
      ...(priorExperiment ? [{ action: "实验完成", status: "实验已完成", location: "四综合试验室", detail: `${task} / 四综合试验 / 实验已完成`, time: time("20:08:34") }] : []),
      ...(explicitDispatch ? [{ status: "送至暂存间", location: "恒温恒湿间（暂存间）", time: time("20:08:36") }] : []),
      { action: "暂存间扫码入库", status: "已到达暂存间", location: "恒温恒湿间（暂存间）", detail: `${tray} 已到达暂存间`, time: time("20:08:40") },
      { action: "暂存间扫码出库", status: "送至实验室", location: "盐雾试验室", detail: `${tray} 送至盐雾试验室`, time: time("20:08:55") },
      { status: "已到达实验室", location: "盐雾试验室", time: time("20:09:06") },
      { status: "工装夹具安装", location: "盐雾试验室", time: time("20:09:08") },
      { status: "实验准备就绪", location: "盐雾试验室", time: time("20:09:11") },
      { status: "实验进行中", location: "盐雾试验室", detail: `${task} / 盐雾试验 / 实验进行中`, time: time("20:09:11") },
    ];
    return {
      taskCode: task, trayCode: tray, status: "实验进行中", location: "盐雾试验室",
      tasks: [{ code: task, status: "任务进行中" }],
      experiments: [
        ...(priorExperiment ? [{ task_code: task, experiment_code: prior, experiment_name: "四综合试验", required_device: "四综合试验室", status: "实验已完成" }] : []),
        { task_code: task, experiment_code: salt, experiment_name: "盐雾试验", required_device: "盐雾试验室", status: "实验进行中" },
      ],
      schedules: [{ id: "S", task_code: task, experiment_code: salt, device: "盐雾试验室", status: "实验进行中" }],
      experimentTrays: [salt, ...(priorExperiment ? [prior] : [])].map((experiment_code) => ({ task_code: task, experiment_code, tray_code: tray })),
      experimentRuns: [
        ...(priorExperiment ? [{ task_code: task, experiment_code: prior, run_no: "R-FOUR", device: "四综合试验室", status: "实验已完成", started_at: time("20:07:00"), ended_at: time("20:08:34") }] : []),
        { task_code: task, experiment_code: salt, run_no: "R-SALT", device: "盐雾试验室", status: paused ? "实验暂停" : "实验进行中", started_at: time("20:09:11") },
      ],
      experimentRunTrays: [
        ...(priorExperiment ? [{ task_code: task, experiment_code: prior, run_no: "R-FOUR", tray_code: tray, run_tray_status: "实验已完成", ended_at: time("20:08:34") }] : []),
        { task_code: task, experiment_code: salt, run_no: "R-SALT", tray_code: tray, run_tray_status: "实验进行中" },
      ],
      experimentRunPauses: paused ? [{ pause_no: "P", run_no: "R-SALT", task_code: task, experiment_code: salt, lab_code: "LAB_SALT", status: "实验暂停", paused_at: time("20:10:00"), inspection_tray_codes: [tray] }] : [],
      samples: [{ code: "SP", task_code: task, location: "盐雾试验室", status: "实验进行中", flow_status: "实验进行中", trays: [{ tray_code: tray, quantity: 1, status: "实验进行中", target_experiment_code: salt, target_lab: "盐雾试验室" }], history }],
      stagingEvents: [
        { task_code: task, tray_code: tray, room: "staging", action: "stock_in", status: "已到达暂存间", location: "恒温恒湿间（暂存间）", time: time("20:08:40") },
        { task_code: task, tray_code: tray, room: "staging", action: "stock_out", target_lab: "盐雾试验室", target_lab_code: "LAB_SALT", time: time("20:08:55") },
      ],
    };
  }

  const summary = (flow) => ({
    status: flow.status,
    steps: flow.steps.map((step) => ({ key: step.key, label: step.label, active: step.active, reached: step.reached, time: step.time, tone: resolveVisualFlowStepTone(step), pauseResetState: step.pauseResetState })),
  });
  const beforeInput = snapshot();
  const pausedInput = snapshot({ paused: true });
  const unchangedInput = structuredClone(pausedInput);
  const report = {
    before: summary(buildTrayFlowView(beforeInput)),
    pausedEngine: summary(buildTrayFlowEngine(pausedInput)),
    paused: summary(buildTrayFlowView(pausedInput)),
    explicitDispatchControl: summary(buildTrayFlowView(snapshot({ paused: true, explicitDispatch: true }))),
    saltFirstWithDispatchControl: summary(buildTrayFlowView(snapshot({ paused: true, priorExperiment: false, explicitDispatch: true }))),
    saltFirstWithoutDispatchControl: summary(buildTrayFlowView(snapshot({ paused: true, priorExperiment: false }))),
  };
  const sent = (flow) => flow.steps.find((step) => step.label === "送至暂存间");
  const arrived = (flow) => flow.steps.find((step) => step.label === "已到达暂存间");
  assert.equal(sent(report.before).reached, true);
  assert.equal(sent(report.before).time, "");
  assert.equal(sent(report.pausedEngine).reached, true);
  assert.equal(sent(report.paused).reached, true);
  assert.equal(sent(report.paused).time, "");
  assert.equal(sent(report.paused).tone, "inferred");
  assert.equal(arrived(report.paused).reached, true);
  assert.equal(arrived(report.paused).time, "2026-11-12 20:08:40");
  assert.equal(sent(report.explicitDispatchControl).reached, true);
  assert.equal(sent(report.saltFirstWithDispatchControl).reached, true);
  assert.equal(sent(report.saltFirstWithoutDispatchControl).reached, true);
  assert.deepEqual(pausedInput, unchangedInput);
  await fs.writeFile(new URL("./salt-pause-staging-fixed.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
  for (const [name, flow] of Object.entries(report)) {
    console.log(JSON.stringify({ scenario: name, staging: flow.steps.filter((step) => ["送至暂存间", "已到达暂存间"].includes(step.label)) }));
  }
  console.log("PASS: staging dispatch stays reached after pause without an invented time; controls passed; input unchanged.");
} finally {
  await server.close();
}
