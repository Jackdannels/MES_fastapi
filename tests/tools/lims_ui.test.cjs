const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("../../frontend/node_modules/jsdom");
const root = path.resolve(__dirname, "../../tools/lims_simulator/static");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"), {
    url: "http://localhost/#interactions", runScripts: "outside-only",
  });
  const requests = [];
  let data = { total: 21, items: [{ received_at: "now", event: {
    event_id: "E1", type: "mes.external-intake.received.v1", payload: { code: "TASK-1", detail: "<img src=x onerror=alert(1)>" },
  } }] };
  let fail = false;
  dom.window.fetch = async (url) => {
    requests.push(url);
    return { ok: !fail, json: async () => url === "/api/state"
      ? { http_receiver: { received_count: 21, auth_required: false, path: "/api/mes/events" } }
      : data };
  };
  dom.window.eval(fs.readFileSync(path.join(root, "interactions.js"), "utf8"));
  const $ = (id) => dom.window.document.getElementById(id);
  return { dom, $, requests, setData: (value) => { data = value; }, setFail: () => { fail = true; } };
}

test("two-page navigation preserves task draft and exposes selected route", async () => {
  const { dom, $ } = setup();
  try {
    await tick();
    assert.equal($("interactionPage").hidden, false);
    assert.equal($("interactionTab").getAttribute("aria-current"), "page");
    $("code").value = "DRAFT";
    dom.window.location.hash = "#dispatch";
    dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
    assert.equal($("dispatchPage").hidden, false);
    assert.equal($("interactionPage").hidden, true);
    assert.equal($("code").value, "DRAFT");
  } finally { dom.window.close(); }
});

test("inbox renders text safely, preserves expanded details, filters and paginates", async () => {
  const { dom, $, requests } = setup();
  try {
    await tick();
    assert.equal($("interactions").querySelector("img"), null);
    assert.match($("interactions").textContent, /<img/);
    const details = $("interactions").querySelector("details");
    details.open = true;
    $("refreshInteractions").click(); await tick();
    assert.equal($("interactions").querySelector("details"), details);
    assert.equal(details.open, true);
    $("nextInteractions").click(); await tick();
    assert.match(requests.at(-2), /offset=20/);
    $("interactionTaskCode").value = " TASK-1 ";
    $("interactionFilter").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await tick();
    assert.match(requests.at(-2), /task_code=TASK-1&limit=20&offset=0/);
    $("clearInteractionFilter").click(); await tick();
    assert.equal($("interactionTaskCode").value, "");
  } finally { dom.window.close(); }
});

test("failed refresh retains received data and offers retry; empty filter is distinct", async () => {
  const { dom, $, setFail, setData } = setup();
  try {
    await tick();
    setData({ total: 0, items: [] });
    $("interactionTaskCode").value = "missing";
    $("interactionFilter").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
    await tick();
    assert.match($("interactions").textContent, /未找到该任务/);
    const retained = $("interactions").textContent;
    setFail(); $("refreshInteractions").click(); await tick();
    assert.equal($("interactions").textContent, retained);
    assert.match($("interactionFeedback").textContent, /重试/);
    assert.equal($("refreshInteractions").disabled, false);
  } finally { dom.window.close(); }
});

test("completion presents sample mapping, personnel, all axes, unknown durations and safe data links", async () => {
  const { dom, $, setData } = setup();
  try {
    await tick();
    setData({ total: 1, raw_total: 2, items: [{ received_at: "now", event: {
      event_id: "C1-v2", type: "mes.experiment.completion.v1", payload: {
        completion_id: "C1", revision: 2, code: "TASK-1", task_name: "耐久试验任务",
        experiment_code: "EXP-1", experiment_name: "振动试验", completed_at: "2026-09-18T12:00:00+08:00",
        tray_codes: ["TRAY-1", "TRAY-2"],
        trays: [{ tray_code: "TRAY-1", samples: [{ sample_code: "SAMPLE-1", sample_name: "<img src=x>", sample_type: "电机" }] },
          { tray_code: "TRAY-2", samples: [{ sample_code: "SAMPLE-2", sample_name: "第二份样品" }] }],
        personnel: [{ username: "operator", employee_name: "张三", attendance_seconds: 120, login_seconds: null,
          sessions: [{ session_id: "SESSION-1", logged_in_at: "10:00", logged_out_at: null, cutoff_at: "12:00" }],
          work_intervals: [{ interval_id: "INTERVAL-1", run_no: 1, started_at: "10:00", ended_at: "10:02", seconds: 120 }] }],
        executions: [{ execution_id: "EXEC-x", run_no: 1, axis_code: "x", running_seconds: null, elapsed_seconds: 180, duration_source: "mqtt_events" },
          { execution_id: "EXEC-y", run_no: 1, axis_code: "y", running_seconds: 0, elapsed_seconds: 0 }],
        data: { status: "partial", missing_count: 1, url: "https://mes.example/completion/C1", files: [
          { export_key: "FILE-1", file_name: "报告.pdf", sample_code: "SAMPLE-1", axis_code: "x", url: "https://mes.example/report.pdf" },
          { export_key: "FILE-2", sample_code: "SAMPLE-2", url: "javascript:alert(1)" },
          { export_key: "FILE-3", url: "file:///C:/report.pdf" },
          { export_key: "FILE-4", url: null },
          { export_key: "FILE-5", url: "https://secret:token@mes.example/report" },
        ] }, data_quality: ["缺少运行开始事件"],
      },
    } }] });
    $("refreshInteractions").click(); await tick();
    const content = $("interactions").querySelector(".completion-content");
    assert.match(content.textContent, /C1 \/ v2/);
    assert.match(content.textContent, /登录覆盖时长无/);
    assert.match(content.textContent, /考勤时长120 秒/);
    assert.match(content.textContent, /实际运行时长无/);
    assert.match(content.textContent, /实际运行时长0 秒/);
    assert.match(content.textContent, /退出时间（考勤截止）2026-09-18 12:00:00/);
    assert.match(content.textContent, /人员姓名张三/);
    assert.match(content.textContent, /登录人员张三/);
    assert.doesNotMatch(content.textContent, /operator|未知|\+08:00/);
    assert.match(content.textContent, /EXEC-x/);
    assert.match(content.textContent, /EXEC-y/);
    assert.match(content.textContent, /MQTT 设备事件计算/);
    assert.match(content.textContent, /部分就绪/);
    assert.match(content.textContent, /缺少运行开始事件/);
    assert.equal(content.querySelector("img"), null);
    const trays = [...content.querySelectorAll("h4")];
    assert.match(trays[0].parentElement.textContent, /TRAY-1.*SAMPLE-1/);
    assert.doesNotMatch(trays[0].parentElement.textContent, /SAMPLE-2/);
    assert.match(trays[1].parentElement.textContent, /TRAY-2.*SAMPLE-2/);
    const links = [...content.querySelectorAll("a")];
    assert.equal(links.length, 2);
    for (const link of links) {
      assert.match(link.href, /^https:\/\/mes\.example\//);
      assert.equal(link.rel, "noopener noreferrer");
      assert.equal(link.target, "_blank");
    }
    assert.match(content.textContent, /链接不可用/);
    assert.match(content.textContent, /打开实验数据文件：无/);
    assert.match($("interactionFeedback").textContent, /共 1 条业务记录/);
  } finally { dom.window.close(); }
});

test("incomplete or malformed optional completion sections degrade to explicit empty states", async () => {
  const { dom, $, setData } = setup();
  try {
    await tick();
    setData({ total: 1, items: [{ received_at: "now", event: {
      type: "mes.experiment.completion.v1", payload: {
        code: "TASK-1", completion_id: "C1", revision: 1, experiment_code: "EXP-1",
        personnel: "invalid", executions: [null, false], trays: [{ tray_code: "T1", samples: "invalid" }], data: null,
      },
    } }] });
    $("refreshInteractions").click(); await tick();
    const content = $("interactions").querySelector(".completion-content").textContent;
    assert.match(content, /人员登录与考勤（0）无/);
    assert.match(content, /设备运行与执行阶段（0）无/);
    assert.match(content, /托盘 T1无/);
    assert.match(content, /实验数据文件（0）无/);
    assert.equal($("interactionFeedback").classList.contains("is-error"), false);
  } finally { dom.window.close(); }
});

test("Beijing display converts offsets and UTC, preserves naive Beijing time and never mutates raw event", async () => {
  const { dom, $, setData } = setup();
  try {
    await tick();
    const event = { type: "mes.experiment.completion.v1", payload: {
      code: "TASK-1", completion_id: "C1", revision: 1, experiment_code: "EXP-1",
      completed_at: "2026-09-18T20:50:06+08:00",
      personnel: [{ employee_name: "李四", username: "account-17", sessions: [
        { session_id: 1, logged_in_at: "2026-09-18T12:50:00Z", logged_out_at: null, cutoff_at: "2026-09-18 20:50:06" },
        { session_id: 2, logged_in_at: "2026-09-18T01:00:00-04:00", logged_out_at: "2026-09-18T14:00:00+08:00", cutoff_at: "2026-09-18T20:50:06+08:00" },
        { session_id: 3, logged_in_at: "2026-09-18 20:50:00", logged_out_at: "2026-09-18T21:00:00+08:00" },
      ], work_intervals: [{ started_at: "2026-09-18T12:50:05Z", ended_at: "2026-09-18 20:50:06", seconds: 1 }] }],
      executions: [{ started_at: "2026-09-18T16:00:00Z", ended_at: "2026-09-18T16:01:00Z" },
        { started_at: "invalid", ended_at: null }],
    } };
    const original = JSON.stringify(event);
    setData({ total: 1, items: [{ received_at: "2026-09-18T12:50:09Z", event }] });
    $("refreshInteractions").click(); await tick();
    const content = $("interactions").querySelector(".completion-content");
    const exits = [...content.querySelectorAll("dt")].filter((n) => n.textContent === "退出时间（考勤截止）").map((n) => n.nextElementSibling.textContent);
    assert.deepEqual(exits, ["2026-09-18 20:50:06", "2026-09-18 14:00:00", "2026-09-18 20:50:06"]);
    assert.match(content.textContent, /登录时间2026-09-18 20:50:00/);
    assert.match(content.textContent, /登录时间2026-09-18 13:00:00/);
    assert.match(content.textContent, /2026-09-19 00:00:00 → 2026-09-19 00:01:00/);
    assert.match(content.textContent, /无 → 无/);
    assert.doesNotMatch(content.textContent, /account-17|未知|T20:|\+08:00|Z/);
    assert.match($("interactions").querySelector(".interaction-card > p").textContent, /2026-09-18 20:50:09/);
    assert.equal(JSON.stringify(event), original);
    assert.equal($("interactions").querySelector(".interaction-card > details pre").textContent, JSON.stringify(event, null, 2));
  } finally { dom.window.close(); }
});

test("execution tray/sample rows match exact trays, deduplicate and exclude unrelated samples", async () => {
  const { dom, $, setData } = setup();
  try {
    await tick();
    setData({ total: 1, items: [{ event: { type: "mes.experiment.completion.v1", payload: {
      code: "TASK-1", completion_id: "C1", revision: 1, experiment_code: "EXP-1",
      trays: [
        { tray_code: "P1", samples: [{ sample_code: "S10" }, { sample_code: "S2" }, { sample_code: "S2" }] },
        { tray_code: "P2", samples: [{ sample_code: "S3" }, { sample_code: "S4" }] },
        { tray_code: "P3", samples: [{ sample_code: "UNRELATED" }] },
      ], executions: [{ tray_codes: ["P1", "P2", "P1", "MISSING", "<img src=x>"] }, { tray_codes: [] }],
      personnel: [{ username: "do-not-use-as-name", employee_name: "  ", attendance_seconds: 0 }],
    } } }] });
    $("refreshInteractions").click(); await tick();
    const maps = $("interactions").querySelectorAll(".completion-tray-samples");
    assert.deepEqual([...maps[0].querySelectorAll("li")].map((n) => n.textContent), ["P1：S2、S10", "P2：S3、S4", "MISSING：无", "<img src=x>：无"]);
    assert.doesNotMatch(maps[0].textContent, /UNRELATED/);
    assert.equal(maps[0].querySelector("img"), null);
    assert.equal(maps[1].textContent, "涉及托盘及样品无");
    const content = $("interactions").querySelector(".completion-content").textContent;
    assert.match(content, /人员姓名无/);
    assert.match(content, /考勤时长0 秒/);
    assert.doesNotMatch(content, /do-not-use-as-name/);
  } finally { dom.window.close(); }
});
