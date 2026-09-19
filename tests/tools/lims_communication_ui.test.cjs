const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("../../frontend/node_modules/jsdom");
const root = path.resolve(__dirname, "../../tools/lims_simulator/static");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const dom = new JSDOM(fs.readFileSync(path.join(root, "index.html"), "utf8"), { url: "http://localhost/#communication", runScripts: "outside-only" });
  const requests = [];
  let data = { mes: { enabled: true, running: true, stale: false, phase: "offline", http: "offline", rabbitmq: "unknown",
    alarm: "critical", retry_count: 3, next_check_at: Date.now() / 1000 + 10, server_time: Date.now() / 1000,
    retry_interval_seconds: 10, check_interval_seconds: 60, detail: "retry", pending_count: 1, out_cursor: 0, in_cursor: 0,
    differences: [], history: [{ at: 100, kind: "critical", detail: "<img src=x onerror=alert(1)>" }] },
    dispatch: { total: 2, pending: 1, items: [] }, faults: {} };
  let fail = false;
  dom.window.fetch = async (url, options = {}) => {
    requests.push([url, options]);
    if (fail) throw new Error("network lost");
    return { ok: true, json: async () => options.method === "POST" ? { ok: true, message: "queued" } : data };
  };
  dom.window.eval(fs.readFileSync(path.join(root, "interactions.js"), "utf8"));
  dom.window.eval(fs.readFileSync(path.join(root, "communication.js"), "utf8"));
  const $ = (id) => dom.window.document.getElementById(id);
  return { dom, $, requests, setFail: () => { fail = true; }, setData: (value) => { data = value; },
    setAlarm: (alarm, acknowledged = false) => { data.mes.alarm = alarm; data.mes.acknowledged = acknowledged; } };
}

test("communication tab preserves task draft and displays ten-second escalation safely", async () => {
  const { dom, $ } = setup();
  try {
    await tick();
    assert.equal($("communicationPage").hidden, false);
    assert.equal($("dispatchPage").hidden, true);
    assert.equal($("interactionPage").hidden, true);
    assert.match($("communicationAlarm").textContent, /严重告警/);
    assert.ok($("communicationAlarm").closest("article").classList.contains("communication-critical"));
    assert.match($("communicationRetries").textContent, /3 \/ 3/);
    assert.match($("communicationPolicy").textContent, /10 秒/);
    assert.equal($("communicationHistory").querySelector("img"), null);
    $("code").value = "DRAFT";
    dom.window.location.hash = "#dispatch";
    dom.window.dispatchEvent(new dom.window.HashChangeEvent("hashchange"));
    assert.equal($("code").value, "DRAFT");
    assert.equal($("communicationPage").hidden, true);
  } finally { dom.window.close(); }
});

test("failed status requests clear online claims instead of showing cached health", async () => {
  const { dom, $, setFail } = setup();
  try {
    await tick();
    setFail(); $("refreshCommunication").click(); await tick();
    assert.equal($("communicationPhase").textContent, "未确认");
    assert.equal($("communicationAlarm").closest("article").classList.contains("communication-critical"), false);
    assert.equal($("communicationCountdown").textContent, "—");
    assert.match($("communicationFeedback").textContent, /network lost/);
  } finally { dom.window.close(); }
});

test("critical alarm keeps pulsing when acknowledged but stops after recovery", async () => {
  const { dom, $, setAlarm } = setup();
  try {
    await tick();
    const card = $("communicationAlarm").closest("article");
    setAlarm("critical", true); $("refreshCommunication").click(); await tick();
    assert.ok(card.classList.contains("communication-critical"));
    assert.match($("communicationAlarm").textContent, /已知悉/);
    setAlarm("warning"); $("refreshCommunication").click(); await tick();
    assert.equal(card.classList.contains("communication-critical"), false);
    setAlarm("none"); $("refreshCommunication").click(); await tick();
    assert.equal(card.classList.contains("communication-critical"), false);
    assert.equal($("communicationAlarm").textContent, "无告警");
  } finally { dom.window.close(); }
});

test("critical frame has slow pulse and a static reduced-motion alternative", () => {
  const css = fs.readFileSync(path.join(root, "styles.css"), "utf8");
  assert.match(css, /communication-critical-pulse 1\.6s ease-in-out infinite/);
  assert.match(css, /prefers-reduced-motion: reduce[^}]*\.communication-critical::before\s*\{ animation: none; opacity: 1;/);
});

test("acknowledge and restore send explicit operations without changing alarm locally", async () => {
  const { dom, $, requests } = setup();
  try {
    await tick(); $("acknowledgeCommunication").click(); await tick();
    const ack = requests.find(([url]) => url === "/api/communication/action");
    assert.equal(JSON.parse(ack[1].body).action, "acknowledge");
    assert.match($("communicationAlarm").textContent, /严重告警/);
    $("restoreCommunication").click(); await tick();
    const restore = requests.find(([url]) => url === "/api/communication/faults");
    assert.deepEqual(JSON.parse(restore[1].body), {});
    assert.match($("communicationAlarm").textContent, /严重告警/);
  } finally { dom.window.close(); }
});
