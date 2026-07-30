import { mount } from "@vue/test-utils";
import { nextTick, reactive } from "vue";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import LaboratoryPage from "./page.vue";
import { HOST_INTERFACE_MODE_STORAGE_KEY, HOST_INTERFACE_MODES, writeHostInterfaceMode } from "@/lib/hostInterfaceMode";
import { SNAPSHOT_UPDATED_EVENT } from "@/lib/storageApi";
import { STORAGE_KEYS } from "@/lib/storageKeys";
import { SAMPLES_UPDATED_EVENT } from "@/modules/samples/sampleEvents";

let wrapper;
let pageHeader;
let headerActions;
let attendanceSessionState;
let masterLabsState;
let snapshotState;
let storageGetSnapshotOverride;
const resetTaskButton = () => headerActions?.querySelector('[data-testid="laboratory-reset-task"]');
const clickResetTask = async () => {
  await flushPageUpdates();
  resetTaskButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await flushPageUpdates();
};
const WITHDRAWABLE_LAB_STATUSES = new Set(["已到达实验室", "工装夹具安装", "实验准备就绪"]);
const { routeState } = vi.hoisted(() => ({
  routeState: {
    query: {},
  },
}));
const reactiveRoute = reactive(routeState);

vi.mock("vue-router", () => ({
  useRoute: () => reactiveRoute,
}));

const toDisplayedTime = (value) => {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};
const toDisplayedDateTime = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${toDisplayedTime(value)}`;
};
const flushPageUpdates = async (cycles = 4) => {
  for (let index = 0; index < cycles; index += 1) {
    await Promise.resolve();
  }
  await nextTick();
};
const storageGetCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/storage") && (options.method || "GET") === "GET");
const storagePutCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/storage") && (options.method || "GET") === "PUT");
const masterLabsGetCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/master/labs") && (options.method || "GET") === "GET");
const laboratoryMqCalls = () =>
  fetch.mock.calls.filter(([input]) => String(input).includes("/api/mq/laboratory"));
const interfaceModeCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/mq/interface-mode") && (options.method || "GET") === "POST");
const laboratoryEndRequestCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/mq/laboratory/end-request") && (options.method || "GET") === "POST");
const laboratoryStartCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/laboratory/") && String(input).includes("/start") && (options.method || "GET") === "POST");
const laboratoryOperationCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/laboratory/operations") && (options.method || "GET") === "POST");
const attendanceWorkStartCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/attendance/labs/") && String(input).includes("/work/start") && (options.method || "GET") === "POST");
const attendanceLogoutCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/attendance/labs/") && String(input).includes("/logout") && (options.method || "GET") === "POST");
const attendanceQrLoginCalls = () =>
  fetch.mock.calls.filter(([input, options = {}]) => String(input).includes("/api/attendance/labs/") && String(input).includes("/login/qr") && (options.method || "GET") === "POST");
const handleAttendanceFetch = (url, options = {}) => {
  if (!String(url).includes("/api/attendance/labs/")) {
    return null;
  }
  const labName = decodeURIComponent(String(url).match(/\/api\/attendance\/labs\/([^/]+)/)?.[1] || "盐雾试验室");
  if (String(url).includes("/work/start")) {
    attendanceSessionState = {
      ...attendanceSessionState,
      active: true,
      labName,
      workStartedAt: attendanceSessionState.workStartedAt || "2026-04-02T10:00:00Z",
    };
    return { ok: true, status: 200, json: async () => attendanceSessionState };
  }
  if (String(url).includes("/session")) {
    return { ok: true, status: 200, json: async () => ({ ...attendanceSessionState, labName }) };
  }
  if (String(url).includes("/login/qr")) {
    const body = JSON.parse(String(options.body || "{}"));
    attendanceSessionState = {
      active: true,
      employeeName: body.qrPayload ? "扫码员工" : "",
      labName,
      loggedInAt: "2026-04-02T10:00:00Z",
      workStartedAt: null,
      username: body.qrPayload ? "qr-worker" : "",
    };
    return { ok: true, status: 200, json: async () => attendanceSessionState };
  }
  if (String(url).includes("/login")) {
    const body = JSON.parse(String(options.body || "{}"));
    attendanceSessionState = {
      active: true,
      employeeName: body.username === "zhangsan" ? "张三" : body.username,
      labName,
      loggedInAt: "2026-04-02T10:00:00Z",
      workStartedAt: null,
      username: body.username,
    };
    return { ok: true, status: 200, json: async () => attendanceSessionState };
  }
  if (String(url).includes("/logout")) {
    attendanceSessionState = { ...attendanceSessionState, active: false, labName, loggedOutAt: "2026-04-02T10:30:00Z" };
    return { ok: true, status: 200, json: async () => attendanceSessionState };
  }
  return null;
};
const handleLaboratoryOperationFetch = (url, options = {}) => {
  if (!String(url).includes("/api/laboratory/operations")) {
    return null;
  }
  const body = JSON.parse(String(options.body || "{}"));
  const taskCode = String(body.taskCode || "").trim();
  const experimentCode = String(body.experimentCode || "").trim();
  const operationType = String(body.operationType || "").trim();
  const trayCodes = new Set((Array.isArray(body.trayCodes) ? body.trayCodes : []).map(String));
  const operationStatuses = {
    compare: "已到达实验室",
    install: "工装夹具安装",
    ready: "实验准备就绪",
    fixtureReady: "工装夹具安装",
  };
  const operationActions = {
    compare: "任务比对",
    install: "样品安装",
    ready: "实验确认",
  };
  const nextStatus = operationStatuses[operationType];
  const experiment = (snapshotState[STORAGE_KEYS.experiments] || []).find(
    (entry) => entry.task_code === taskCode && entry.experiment_code === experimentCode,
  );
  const experimentName = experiment?.experiment_name || experimentCode;
  const occurredAt = body.occurredAt || new Date().toISOString();
  const touchedTrayCodes = new Set();
  snapshotState = {
    ...snapshotState,
    [STORAGE_KEYS.samples]: (snapshotState[STORAGE_KEYS.samples] || []).map((sample) => {
      if (sample.task_code !== taskCode || !Array.isArray(sample.trays)) {
        return sample;
      }
      const touchesCurrentSample = sample.trays.some((tray) => trayCodes.has(String(tray.tray_code || "")));
      if (!touchesCurrentSample) {
        return sample;
      }
      const nextTrays = sample.trays.map((tray) => {
        const trayCode = String(tray.tray_code || "");
        if (!trayCodes.has(trayCode)) {
          return tray;
        }
        touchedTrayCodes.add(trayCode);
        if (operationType === "fixtureReady") {
          return { ...tray, fixtureReady: true, fixture_ready: true };
        }
        const nextTray = { ...tray, status: nextStatus, updated_at: occurredAt };
        if (operationType === "install") {
          delete nextTray.fixtureReady;
          delete nextTray.fixture_ready;
        }
        return nextTray;
      });
      const historyEntry = operationActions[operationType]
        ? {
            action: operationActions[operationType],
            detail: `${taskCode} / ${experimentName} / ${nextStatus}`,
            location: body.labName || sample.location || "",
            owner: sample.owner || "",
            status: nextStatus,
            time: occurredAt,
          }
        : null;
      return {
        ...sample,
        flow_status: nextStatus,
        history: historyEntry ? [historyEntry, ...(Array.isArray(sample.history) ? sample.history : [])] : sample.history,
        location: body.labName || sample.location,
        status: nextStatus,
        trays: nextTrays,
        updated_at: occurredAt,
      };
    }),
  };
  return {
    ok: true,
    status: 200,
    json: async () => ({
      affectedTrayCodes: Array.from(touchedTrayCodes).sort(),
      ok: true,
      operationType,
      samples: snapshotState[STORAGE_KEYS.samples],
    }),
  };
};
const waitForLaboratoryMqCall = async (endpoint) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    const matchedCall = fetch.mock.calls.find(([input]) => String(input).includes(endpoint));
    if (matchedCall) {
      return matchedCall;
    }
  }
  return fetch.mock.calls.find(([input]) => String(input).includes(endpoint));
};
const waitForLaboratoryEndRequestCount = async (count) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (laboratoryEndRequestCalls().length >= count) {
      const requestCallIndex = fetch.mock.calls.findLastIndex(([input]) => String(input).includes("/api/mq/laboratory/end-request"));
      for (let refreshAttempt = 0; refreshAttempt < 10; refreshAttempt += 1) {
        vi.advanceTimersByTime(100);
        await flushPageUpdates();
        const refreshedAfterRequest = fetch.mock.calls
          .slice(requestCallIndex + 1)
          .some(([input, options = {}]) => String(input).includes("/api/storage") && (options.method || "GET") === "GET");
        if (refreshedAfterRequest) {
          await flushPageUpdates(10);
          return;
        }
      }
      return;
    }
  }
  expect(laboratoryEndRequestCalls()).toHaveLength(count);
};
const waitForLaboratoryStartCount = async (count) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (laboratoryStartCalls().length >= count) {
      return;
    }
  }
  expect(laboratoryStartCalls()).toHaveLength(count);
};
const waitForAttendanceWorkStartCount = async (count) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (attendanceWorkStartCalls().length >= count) {
      return;
    }
  }
  expect(attendanceWorkStartCalls()).toHaveLength(count);
};
const useHostInterfaceMode = (mode) => {
  window.localStorage.getItem.mockImplementation((key) => (key === HOST_INTERFACE_MODE_STORAGE_KEY ? mode : null));
};
const waitForInitialLaboratoryLoad = async (storageCount, masterLabCount) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (storageGetCalls().length >= storageCount && masterLabsGetCalls().length >= masterLabCount) {
      await flushPageUpdates();
      return;
    }
  }
  expect(storageGetCalls()).toHaveLength(storageCount);
  expect(masterLabsGetCalls()).toHaveLength(masterLabCount);
};
const waitForStorageGetCount = async (count, { advanceStorageDebounce = false } = {}) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (advanceStorageDebounce) {
      vi.advanceTimersByTime(100);
    }
    await flushPageUpdates();
    if (storageGetCalls().length >= count) {
      return;
    }
  }
  expect(storageGetCalls()).toHaveLength(count);
};
const waitForSamplesUpdatedEvent = async (spy, count) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (spy.mock.calls.filter(([event]) => event?.type === SAMPLES_UPDATED_EVENT).length >= count) {
      await flushPageUpdates();
      return;
    }
  }
  expect(spy.mock.calls.filter(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toHaveLength(count);
};
const waitForQueueLength = async (queue, count) => {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await flushPageUpdates();
    if (queue.length >= count) {
      return;
    }
  }
  expect(queue).toHaveLength(count);
};
const createSnapshot = () => ({
  [STORAGE_KEYS.tasks]: [
    { code: "SYLU-2026-04-101", name: "盐雾连接器", test_type: "盐雾试验" },
    { code: "SYLU-2026-04-201", name: "盐雾壳体", test_type: "盐雾试验" },
    { code: "SYLU-2026-04-301", name: "复合环境任务", test_type: "高低温湿热试验 / 盐雾试验" },
    { code: "SYLU-2026-04-102", name: "振动连接器", test_type: "振动试验" },
  ],
  [STORAGE_KEYS.experiments]: [
    { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", experiment_name: "盐雾试验-A" },
    { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", experiment_name: "盐雾试验-B" },
    { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", experiment_name: "高低温湿热试验" },
    { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", experiment_name: "盐雾试验" },
    { task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", experiment_name: "振动试验" },
  ],
  [STORAGE_KEYS.experiment_runs]: [],
  [STORAGE_KEYS.experiment_trays]: [
    { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
    { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-002" },
    { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", tray_code: "TP-101" },
    { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", tray_code: "TP-301" },
    { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", tray_code: "TP-301" },
  ],
  [STORAGE_KEYS.samples]: [
    {
      code: "SYLU-2026-04-101-SP-001",
      location: "盐雾试验室",
      owner: "王工",
      status: "已到达实验室",
      task_code: "SYLU-2026-04-101",
      trays: [
        { quantity: 2, status: "到货", tray_code: "TP-001" },
        { quantity: 2, status: "到货", tray_code: "TP-002" },
      ],
    },
    {
      code: "SYLU-2026-04-201-SP-001",
      location: "盐雾试验室",
      owner: "李工",
      status: "已到达实验室",
      task_code: "SYLU-2026-04-201",
      trays: [{ quantity: 1, tray_code: "TP-101" }],
    },
    {
      code: "SYLU-2026-04-301-SP-001",
      location: "接驳区",
      owner: "赵工",
      status: "送至实验室",
      task_code: "SYLU-2026-04-301",
      trays: [{ quantity: 1, tray_code: "TP-301" }],
    },
  ],
  [STORAGE_KEYS.schedules]: [
    {
      id: "schedule-1",
      task_code: "SYLU-2026-04-101",
      experiment_code: "SYLU-2026-04-101-A",
      device: "盐雾试验室",
      start_at: "2026-04-02T09:30:00.000Z",
      end_at: "2026-04-02T11:00:00.000Z",
    },
    {
      id: "schedule-3",
      task_code: "SYLU-2026-04-201",
      experiment_code: "SYLU-2026-04-201-A",
      device: "盐雾试验室",
      start_at: "2026-04-02T12:00:00.000Z",
      end_at: "2026-04-02T13:00:00.000Z",
    },
    {
      id: "schedule-2",
      task_code: "SYLU-2026-04-102",
      experiment_code: "SYLU-2026-04-102-A",
      device: "振动一室",
      start_at: "2026-04-02T09:30:00.000Z",
      end_at: "2026-04-02T11:00:00.000Z",
    },
    {
      id: "schedule-4",
      task_code: "SYLU-2026-04-301",
      experiment_code: "SYLU-2026-04-301-A",
      device: "高低温湿热一室",
      start_at: "2026-04-02T10:30:00.000Z",
      end_at: "2026-04-02T12:00:00.000Z",
    },
    {
      id: "schedule-5",
      task_code: "SYLU-2026-04-301",
      experiment_code: "SYLU-2026-04-301-B",
      device: "盐雾试验室",
      start_at: "2026-04-02T12:30:00.000Z",
      end_at: "2026-04-02T14:00:00.000Z",
    },
  ],
});

const dispatchDefaultComparisonTrays = () => {
  const sample = snapshotState[STORAGE_KEYS.samples]
    .find((item) => item.task_code === "SYLU-2026-04-101");
  if (!sample) {
    return;
  }
  sample.flow_status = "送至实验室";
  sample.location = "盐雾试验室";
  sample.status = "送至实验室";
  sample.trays = sample.trays.map((tray) => ({
    ...tray,
    status: "送至实验室",
    target_experiment_code: "SYLU-2026-04-101-A",
    target_lab: "盐雾试验室",
  }));
};

const addActiveExperimentRun = ({
  device = "盐雾试验室",
  endedAt = "",
  experimentCode = "SYLU-2026-04-101-A",
  plannedEndAt = "2026-04-02T11:00:00.000Z",
  runNo = "run-1",
  scheduleId = "schedule-1",
  snapshot = snapshotState,
  startedAt = "2026-04-02T09:30:00.000Z",
  status = "实验进行中",
  taskCode = "SYLU-2026-04-101",
  trayCodes = ["TP-001"],
} = {}) => {
  snapshot[STORAGE_KEYS.experiment_runs] = [
    ...(Array.isArray(snapshot[STORAGE_KEYS.experiment_runs]) ? snapshot[STORAGE_KEYS.experiment_runs] : []),
    {
      id: runNo,
      run_no: runNo,
      schedule_id: scheduleId,
      task_code: taskCode,
      experiment_code: experimentCode,
      device,
      tray_codes: trayCodes,
      status,
      started_at: startedAt,
      planned_end_at: plannedEndAt,
      ...(endedAt ? { ended_at: endedAt } : {}),
    },
  ];
  return snapshot;
};

const mountPage = async () => {
  const expectedStorageGetCalls = storageGetCalls().length + 1;
  const expectedMasterLabsGetCalls = masterLabsGetCalls().length + 1;
  document.querySelectorAll(".page-header").forEach((element) => element.remove());
  pageHeader = document.createElement("header");
  pageHeader.className = "page-header";
  pageHeader.innerHTML = `
    <div>
      <div class="eyebrow">盐雾试验室操作台</div>
      <h1>盐雾试验室操作台</h1>
      <p class="subtitle">查看盐雾试验室当前任务与实验准备流程。</p>
    </div>
    <div class="header-actions">
      <button class="action-btn secondary" type="button">刷新</button>
      <span class="header-actions-before-logout"></span>
      <button class="action-btn secondary" data-testid="app-logout" type="button">退出登录</button>
    </div>
  `;
  document.body.appendChild(pageHeader);
  headerActions = pageHeader.querySelector(".header-actions");

  wrapper = mount(LaboratoryPage, { attachTo: document.body });
  await waitForInitialLaboratoryLoad(expectedStorageGetCalls, expectedMasterLabsGetCalls);
  return wrapper;
};

const mountPageInsideShell = async () => {
  const expectedStorageGetCalls = storageGetCalls().length + 1;
  const expectedMasterLabsGetCalls = masterLabsGetCalls().length + 1;
  document.querySelectorAll(".page-header").forEach((element) => element.remove());
  const Shell = {
    components: { LaboratoryPage },
    template: `
      <div>
        <header class="page-header">
          <div>
            <div class="eyebrow">盐雾试验室操作台</div>
            <h1>盐雾试验室操作台</h1>
            <p class="subtitle">查看盐雾试验室当前任务与实验准备流程。</p>
          </div>
          <div class="header-actions">
            <span class="header-actions-before-logout"></span>
            <button class="action-btn secondary" data-testid="app-logout" type="button">退出登录</button>
          </div>
        </header>
        <LaboratoryPage />
      </div>
    `,
  };
  wrapper = mount(Shell, { attachTo: document.body });
  await waitForInitialLaboratoryLoad(expectedStorageGetCalls, expectedMasterLabsGetCalls);
  return wrapper;
};

describe("LaboratoryPage runtime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T10:00:00.000Z"));
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
    });
    snapshotState = createSnapshot();
    attendanceSessionState = {
      active: true,
      employeeName: "张三",
      labName: "盐雾试验室",
      loggedInAt: "2026-04-02T09:00:00Z",
      username: "zhangsan",
    };
    masterLabsState = [];
    storageGetSnapshotOverride = null;
    reactiveRoute.query = {};
    const handleFetch = async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/master/labs")) {
        return { ok: true, status: 200, json: async () => masterLabsState };
      }
      const attendanceResponse = handleAttendanceFetch(url, options);
      if (attendanceResponse) {
        return attendanceResponse;
      }
      if (url.includes("/api/mq/laboratory/end-request")) {
        const body = JSON.parse(String(options.body || "{}"));
        const run = (snapshotState[STORAGE_KEYS.experiment_runs] || []).find(
          (entry) => [entry.run_no, entry.id].map((value) => String(value || "").trim()).includes(String(body.run_no || "").trim()),
        );
        await handleFetch(
          `/api/laboratory/tasks/${encodeURIComponent(body.task_code || "")}/experiments/${encodeURIComponent(body.experiment_code || "")}/complete`,
          {
            method: "POST",
            body: JSON.stringify({
              axisCode: body.axis_code || "",
              completedAt: new Date().toISOString(),
              nextAxisCode: body.next_axis_code || "",
              runNo: body.run_no || "",
              subExperimentCode: body.sub_experiment_code || "",
              trayCodes: Array.isArray(run?.tray_codes) ? run.tray_codes : [],
            }),
          },
        );
        window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
          detail: { keys: [STORAGE_KEYS.samples, STORAGE_KEYS.experiment_runs, STORAGE_KEYS.experiment_run_steps] },
        }));
        return { ok: true, status: 200, json: async () => ({ ok: true, published: true }) };
      }
      if (url.includes("/api/laboratory/") && url.includes("/complete")) {
        const match = url.match(/\/api\/laboratory\/tasks\/([^/]+)\/experiments\/([^/]+)\/complete/);
        const taskCode = decodeURIComponent(match?.[1] || "");
        const experimentCode = decodeURIComponent(match?.[2] || "");
        const body = JSON.parse(String(options.body || "{}"));
        const completedAt = body.completedAt || new Date().toISOString();
        const axisCode = String(body.axisCode || "").trim();
        const nextAxisCode = String(body.nextAxisCode || "").trim();
        const subExperimentCode = String(body.subExperimentCode || "").trim();
        const continuesNextAxis = Boolean(axisCode && nextAxisCode);
        const trayCodes = new Set(
          (Array.isArray(body.trayCodes) && body.trayCodes.length ? body.trayCodes : (snapshotState[STORAGE_KEYS.experiment_trays] || [])
            .filter((entry) => entry.task_code === taskCode && entry.experiment_code === experimentCode)
            .map((entry) => entry.tray_code))
            .map(String),
        );
        const experiment = (snapshotState[STORAGE_KEYS.experiments] || []).find(
          (entry) => entry.task_code === taskCode && entry.experiment_code === experimentCode,
        );
        const experimentName = experiment?.experiment_name || experimentCode;
        const completedStatuses = new Set(["实验已完成", "实验已经完成", "实验完成", "实验后暂存间存放", "厂家收回", "已到达暂存间"]);
        const scopedTrayCodes = new Set(
          (snapshotState[STORAGE_KEYS.experiment_trays] || [])
            .filter((entry) => entry.task_code === taskCode && entry.experiment_code === experimentCode)
            .map((entry) => String(entry.tray_code || "").trim())
            .filter(Boolean),
        );
        const runNo = String(body.runNo || "").trim();
        snapshotState = {
          ...snapshotState,
          [STORAGE_KEYS.samples]: continuesNextAxis
            ? (snapshotState[STORAGE_KEYS.samples] || [])
            : (snapshotState[STORAGE_KEYS.samples] || []).map((sample) => {
                if (sample.task_code !== taskCode || !Array.isArray(sample.trays)) {
                  return sample;
                }
                const touchesCompletedTray = sample.trays.some((tray) => trayCodes.has(String(tray.tray_code || "")));
                if (!touchesCompletedTray) {
                  return sample;
                }
                return {
                  ...sample,
                  flow_status: "实验已完成",
                  status: "实验已完成",
                  trays: sample.trays.map((tray) =>
                    trayCodes.has(String(tray.tray_code || "")) ? { ...tray, status: "实验已完成", updated_at: completedAt } : tray,
                  ),
                  history: [
                    {
                      action: "实验完成",
                      detail: `${taskCode} / ${experimentName} / 实验已完成`,
                      location: sample.location || "",
                      owner: sample.owner || "",
                      status: "实验已完成",
                      time: completedAt,
                    },
                    ...(Array.isArray(sample.history) ? sample.history : []),
                  ],
                };
              }),
          [STORAGE_KEYS.experiment_runs]: (snapshotState[STORAGE_KEYS.experiment_runs] || []).map((entry) =>
            !continuesNextAxis
              && (
                (runNo && [entry.run_no, entry.id].map((value) => String(value || "").trim()).includes(runNo))
                  || (
                    !runNo
                    && entry.task_code === taskCode
                    && entry.experiment_code === experimentCode
                    && String(entry.status || "").trim() === "实验进行中"
                    && Array.from(trayCodes).every((trayCode) => (Array.isArray(entry.tray_codes) ? entry.tray_codes : []).map(String).includes(trayCode))
                  )
              )
              ? { ...entry, ended_at: completedAt, status: "实验已完成", updated_at: completedAt }
              : entry,
          ),
          [STORAGE_KEYS.experiment_run_steps]: continuesNextAxis
            ? (snapshotState[STORAGE_KEYS.experiment_run_steps] || []).map((entry) => {
                const matchesRun = runNo ? [entry.run_no, entry.id].map((value) => String(value || "").trim()).includes(runNo) : true;
                const matchesSubExperiment = subExperimentCode
                  ? String(entry.sub_experiment_code || "").trim() === subExperimentCode
                  : true;
                if (
                  matchesRun
                  && matchesSubExperiment
                  && entry.task_code === taskCode
                  && entry.experiment_code === experimentCode
                  && String(entry.axis_code || "").trim() === axisCode
                ) {
                  return { ...entry, ended_at: completedAt, status: "实验已完成", updated_at: completedAt };
                }
                if (
                  matchesRun
                  && matchesSubExperiment
                  && entry.task_code === taskCode
                  && entry.experiment_code === experimentCode
                  && String(entry.axis_code || "").trim() === nextAxisCode
                ) {
                  return { ...entry, status: "实验进行中", started_at: completedAt, updated_at: completedAt };
                }
                return entry;
              })
            : (snapshotState[STORAGE_KEYS.experiment_run_steps] || []),
        };
        const allExperimentTraysCompleted =
          scopedTrayCodes.size > 0
          && Array.from(scopedTrayCodes).every((trayCode) => {
            const statuses = [];
            (snapshotState[STORAGE_KEYS.samples] || []).forEach((sample) => {
              if (sample.task_code !== taskCode || !Array.isArray(sample.trays)) {
                return;
              }
              sample.trays.forEach((tray) => {
                if (String(tray.tray_code || "").trim() === trayCode) {
                  statuses.push(String(tray.status || sample.status || "").trim());
                }
              });
            });
            return statuses.length > 0 && statuses.every((status) => completedStatuses.has(status));
          });
        const nextExperimentStatus = !continuesNextAxis && allExperimentTraysCompleted ? "实验已完成" : "实验进行中";
        snapshotState = {
          ...snapshotState,
          [STORAGE_KEYS.experiments]: (snapshotState[STORAGE_KEYS.experiments] || []).map((entry) =>
            entry.task_code === taskCode && entry.experiment_code === experimentCode ? { ...entry, status: nextExperimentStatus } : entry,
          ),
          [STORAGE_KEYS.schedules]: (snapshotState[STORAGE_KEYS.schedules] || []).map((entry) =>
            entry.task_code === taskCode && entry.experiment_code === experimentCode ? { ...entry, status: nextExperimentStatus } : entry,
          ),
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            samples: snapshotState[STORAGE_KEYS.samples],
            experiments: snapshotState[STORAGE_KEYS.experiments],
            schedules: snapshotState[STORAGE_KEYS.schedules],
            experimentRuns: snapshotState[STORAGE_KEYS.experiment_runs],
            experimentRunSteps: snapshotState[STORAGE_KEYS.experiment_run_steps],
          }),
        };
      }
      if (url.includes("/api/laboratory/") && url.includes("/axis-adjustment-ready")) {
        const body = JSON.parse(String(options.body || "{}"));
        snapshotState = {
          ...snapshotState,
          [STORAGE_KEYS.experiment_run_steps]: (snapshotState[STORAGE_KEYS.experiment_run_steps] || []).map((entry) =>
            String(entry.run_no || "").trim() === String(body.runNo || "").trim()
              && String(entry.axis_code || "").trim() === String(body.axisCode || "").trim()
              ? { ...entry, status: "等待上位机启动" }
              : entry,
          ),
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            experimentRunSteps: snapshotState[STORAGE_KEYS.experiment_run_steps],
            ok: true,
          }),
        };
      }
      if (url.includes("/api/laboratory/") && url.includes("/start")) {
        const match = url.match(/\/api\/laboratory\/tasks\/([^/]+)\/experiments\/([^/]+)\/start/);
        const taskCode = decodeURIComponent(match?.[1] || "");
        const experimentCode = decodeURIComponent(match?.[2] || "");
        const body = JSON.parse(String(options.body || "{}"));
        if (!String(body.runNo || "").trim()) {
          return { ok: false, status: 400, json: async () => ({ detail: "task_code, experiment_code and run_no are required" }) };
        }
        const startedAt = "2026-04-02T10:00:03.000Z";
        const schedule = (snapshotState[STORAGE_KEYS.schedules] || []).find(
          (entry) => entry.task_code === taskCode && entry.experiment_code === experimentCode,
        );
        const trayCodes = (snapshotState[STORAGE_KEYS.experiment_trays] || [])
          .filter((entry) => entry.task_code === taskCode && entry.experiment_code === experimentCode)
          .map((entry) => entry.tray_code);
        const experimentRunTrays = trayCodes.map((trayCode) => ({
          experiment_code: experimentCode,
          run_no: "run-hot-humid-2",
          task_code: taskCode,
          tray_code: trayCode,
        }));
        snapshotState = {
          ...snapshotState,
          [STORAGE_KEYS.samples]: (snapshotState[STORAGE_KEYS.samples] || []).map((sample) =>
            sample.task_code === taskCode
              ? {
                  ...sample,
                  flow_status: "实验进行中",
                  status: "实验进行中",
                  trays: (Array.isArray(sample.trays) ? sample.trays : []).map((tray) =>
                    trayCodes.includes(tray.tray_code) ? { ...tray, status: "实验进行中", updated_at: startedAt } : tray,
                  ),
                }
              : sample,
          ),
          [STORAGE_KEYS.experiments]: (snapshotState[STORAGE_KEYS.experiments] || []).map((entry) =>
            entry.task_code === taskCode && entry.experiment_code === experimentCode ? { ...entry, status: "实验进行中" } : entry,
          ),
          [STORAGE_KEYS.schedules]: (snapshotState[STORAGE_KEYS.schedules] || []).map((entry) =>
            entry.task_code === taskCode && entry.experiment_code === experimentCode ? { ...entry, status: "实验进行中" } : entry,
          ),
          [STORAGE_KEYS.experiment_runs]: [
            ...(snapshotState[STORAGE_KEYS.experiment_runs] || []),
            {
              id: "run-hot-humid-2",
              run_no: "run-hot-humid-2",
              schedule_id: schedule?.id || "",
              task_code: taskCode,
              experiment_code: experimentCode,
              device: schedule?.device || "高低温湿热二室",
              tray_codes: trayCodes,
              status: "实验进行中",
              started_at: startedAt,
              planned_end_at: schedule?.end_at || "",
            },
          ],
          [STORAGE_KEYS.experiment_run_trays]: experimentRunTrays,
        };
        attendanceSessionState = {
          ...attendanceSessionState,
          labName: schedule?.device || "高低温湿热二室",
          workStartedAt: startedAt,
        };
        return {
          ok: true,
          status: 200,
          json: async () => ({
            attendanceSession: attendanceSessionState,
            ok: true,
            samples: snapshotState[STORAGE_KEYS.samples],
            tasks: snapshotState[STORAGE_KEYS.tasks],
            schedules: snapshotState[STORAGE_KEYS.schedules],
            experiments: snapshotState[STORAGE_KEYS.experiments],
            experimentRuns: snapshotState[STORAGE_KEYS.experiment_runs],
            experimentRunTrays: snapshotState[STORAGE_KEYS.experiment_run_trays],
          }),
        };
      }
      if (url.includes("/api/laboratory/") && url.includes("/withdraw-current")) {
        const match = url.match(/\/api\/laboratory\/tasks\/([^/]+)\/experiments\/([^/]+)\/withdraw-current/);
        const taskCode = decodeURIComponent(match?.[1] || "");
        const experimentCode = decodeURIComponent(match?.[2] || "");
        const body = JSON.parse(String(options.body || "{}"));
        const requestedTrayCodes = new Set(
          (Array.isArray(body.trayCodes) ? body.trayCodes : [])
            .map((trayCode) => String(trayCode || "").trim())
            .filter(Boolean),
        );
        const experimentTrayCodes = new Set(
          (snapshotState[STORAGE_KEYS.experiment_trays] || [])
            .filter((entry) => entry.task_code === taskCode && entry.experiment_code === experimentCode)
            .map((entry) => entry.tray_code),
        );
        const trayCodes = requestedTrayCodes.size > 0
          ? new Set(Array.from(experimentTrayCodes).filter((trayCode) => requestedTrayCodes.has(trayCode)))
          : experimentTrayCodes;
        snapshotState = {
          ...snapshotState,
          [STORAGE_KEYS.samples]: (snapshotState[STORAGE_KEYS.samples] || []).map((sample) => {
            if (sample.task_code !== taskCode || !Array.isArray(sample.trays)) {
              return sample;
            }
            const touchesCurrentExperiment = sample.trays.some((tray) => trayCodes.has(tray.tray_code));
            if (!touchesCurrentExperiment) {
              return sample;
            }
            const withdrawableTrayCodes = new Set(
              sample.trays
                .filter((tray) => trayCodes.has(tray.tray_code) && WITHDRAWABLE_LAB_STATUSES.has(String(tray.status || sample.status || "").trim()))
                .map((tray) => tray.tray_code),
            );
            if (withdrawableTrayCodes.size === 0) {
              return sample;
            }
            return {
              ...sample,
              flow_status: "到货",
              location: "接驳区",
              status: "到货",
              trays: sample.trays.map((tray) =>
                withdrawableTrayCodes.has(tray.tray_code)
                  ? { ...tray, fixtureReady: undefined, fixture_ready: undefined, status: "到货" }
                  : tray,
              ),
            };
          }),
        };
        return { ok: true, status: 200, json: async () => ({ ok: true, samples: snapshotState[STORAGE_KEYS.samples] }) };
      }
      if (url.includes("/api/mq/interface-mode")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, mode: HOST_INTERFACE_MODES.mqtt, subscriber_running: true }) };
      }
      if (url.includes("/api/storage")) {
        if ((options.method || "GET") === "PUT") {
          const payload = JSON.parse(String(options.body || "{}"));
          snapshotState = {
            ...snapshotState,
            ...payload,
          };
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        const snapshot = typeof storageGetSnapshotOverride === "function" ? storageGetSnapshotOverride() : snapshotState;
        return { ok: true, status: 200, json: async () => snapshot };
      }
      if (url.includes("/api/mq/laboratory")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: true }) };
      }
      const operationResponse = handleLaboratoryOperationFetch(url, options);
      if (operationResponse) {
        return operationResponse;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    };
    vi.stubGlobal("fetch", vi.fn(handleFetch));
  });

  afterEach(async () => {
    wrapper?.unmount();
    vi.clearAllTimers();
    await flushPageUpdates();
    wrapper = undefined;
    pageHeader?.remove();
    pageHeader = undefined;
    headerActions = undefined;
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  test("does not start attendance work timing when only the compare step begins", async () => {
    attendanceSessionState = {
      active: true,
      employeeName: "张三",
      labName: "盐雾试验室",
      loggedInAt: "2026-04-02T09:00:00Z",
      username: "zhangsan",
      workStartedAt: null,
    };
    dispatchDefaultComparisonTrays();
    await mountPage();

    expect(attendanceWorkStartCalls()).toHaveLength(0);

    await wrapper.get('[data-testid="laboratory-compare"]').trigger("click");
    await flushPageUpdates();

    expect(attendanceWorkStartCalls()).toHaveLength(0);
    expect(wrapper.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(true);
  });

  test("shows the current laboratory login employee as the comparison operator", async () => {
    attendanceSessionState = {
      active: true,
      employeeName: "张三",
      labName: "盐雾试验室",
      loggedInAt: "2026-04-02T09:00:00Z",
      username: "zhangsan",
    };
    dispatchDefaultComparisonTrays();
    await mountPage();

    await wrapper.get('[data-testid="laboratory-compare"]').trigger("click");
    await flushPageUpdates();

    const operatorRow = wrapper
      .findAll(".laboratory-checklist-item")
      .find((row) => row.text().includes("执行人员"));
    expect(operatorRow?.text()).toContain("张三");
    expect(operatorRow?.text()).not.toContain("王工");
  });

  test("keeps attendance work timer at zero after login before any experiment step starts", async () => {
    attendanceSessionState = {
      active: true,
      employeeName: "张三",
      labName: "盐雾试验室",
      loggedInAt: "2026-04-02T09:00:00Z",
      username: "zhangsan",
      workStartedAt: null,
    };
    await mountPage();

    vi.advanceTimersByTime(2000);
    await flushPageUpdates();

    expect(headerActions.textContent || "").toContain("当前 00:00:00");
  });

  test("shows attendance work timer by second after formal work start exists", async () => {
    attendanceSessionState = {
      active: true,
      employeeName: "张三",
      labName: "盐雾试验室",
      loggedInAt: "2026-04-02T09:00:00Z",
      username: "zhangsan",
      workStartedAt: "2026-04-02T09:59:58Z",
    };
    await mountPage();

    expect(headerActions.textContent || "").toContain("当前 00:00:02");
  });

  test("starts attendance work timing when a non-hostless laboratory loads with a running experiment", async () => {
    reactiveRoute.query = { lab: "温度冲击二室" };
    masterLabsState = [
      { code: "LAB_TEMP_SHOCK_2", name: "温度冲击二室", type: "实验室", testTypeName: "温度冲击试验", status: 1 },
    ];
    attendanceSessionState = {
      active: true,
      employeeName: "心鑫",
      labName: "温度冲击二室",
      loggedInAt: "2026-07-03T15:01:00Z",
      username: "xinxin",
      workStartedAt: null,
    };
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-07-021", name: "温度冲击任务", test_type: "温度冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-07-021",
          experiment_code: "SYLU-2026-07-021-A",
          experiment_name: "温度冲击试验",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-07-021", experiment_code: "SYLU-2026-07-021-A", tray_code: "SYLU-2026-07-021-TP-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-temp-shock-2",
          task_code: "SYLU-2026-07-021",
          experiment_code: "SYLU-2026-07-021-A",
          device: "温度冲击二室",
          start_at: "2026-07-03T15:02:00.000Z",
          end_at: "2026-07-03T18:32:00.000Z",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "run-temp-shock-2",
          run_no: "run-temp-shock-2",
          schedule_id: "schedule-temp-shock-2",
          task_code: "SYLU-2026-07-021",
          experiment_code: "SYLU-2026-07-021-A",
          device: "温度冲击二室",
          tray_codes: ["SYLU-2026-07-021-TP-001"],
          status: "实验进行中",
          started_at: "2026-07-03T15:02:00.000Z",
          planned_end_at: "2026-07-03T18:32:00.000Z",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-07-021-SP-001",
          location: "温度冲击二室",
          owner: "赵工",
          status: "实验进行中",
          flow_status: "实验进行中",
          task_code: "SYLU-2026-07-021",
          trays: [{ fixtureReady: true, fixture_ready: true, quantity: 1, status: "实验进行中", tray_code: "SYLU-2026-07-021-TP-001" }],
        },
      ],
    };

    await mountPage();

    await waitForAttendanceWorkStartCount(1);

    expect(attendanceWorkStartCalls()[0][0]).toBe("/api/attendance/labs/%E6%B8%A9%E5%BA%A6%E5%86%B2%E5%87%BB%E4%BA%8C%E5%AE%A4/work/start");
    vi.advanceTimersByTime(3000);
    await flushPageUpdates();
    expect(document.body.querySelector('[data-testid="laboratory-attendance-status"]')?.textContent || "").not.toContain("当前 00:00:00");
  });

  test("starts work timing for the newly logged employee when switching during a running experiment", async () => {
    attendanceSessionState = {
      active: true,
      employeeName: "张三",
      labName: "盐雾试验室",
      loggedInAt: "2026-04-02T09:00:00Z",
      username: "zhangsan",
      workStartedAt: null,
    };
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = snapshotState[STORAGE_KEYS.experiments].map((experiment) =>
      experiment.experiment_code === "SYLU-2026-04-101-A"
        ? { ...experiment, status: "实验进行中" }
        : experiment,
    );
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    addActiveExperimentRun();

    await mountPage();
    await waitForAttendanceWorkStartCount(1);

    headerActions.querySelector('[data-testid="laboratory-attendance-login"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    document.body.querySelector('[data-testid="laboratory-attendance-password-mode"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    const usernameInput = document.body.querySelector('[data-testid="laboratory-attendance-username"]');
    const passwordInput = document.body.querySelector('[data-testid="laboratory-attendance-password"]');
    usernameInput.value = "lisi";
    usernameInput.dispatchEvent(new Event("input", { bubbles: true }));
    passwordInput.value = "123";
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    document.body.querySelector('[data-testid="laboratory-attendance-login-submit"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    await waitForAttendanceWorkStartCount(2);
    expect(attendanceSessionState.username).toBe("lisi");
  });

  test("renders fixed laboratory login controls before the running modal button when no employee is logged in", async () => {
    attendanceSessionState = {
      active: false,
      employeeName: "",
      labName: "盐雾试验室",
      loggedInAt: null,
      username: "",
    };
    await mountPage();

    const headerText = headerActions.textContent || "";
    const resetButton = resetTaskButton();
    expect(headerText).toContain("试验间登录");
    expect(headerText).toContain("重置试验室任务");
    expect(headerText).toContain("未登录");
    expect(headerText).toContain("请先登录后操作");
    expect(headerText.indexOf("重置试验室任务")).toBeLessThan(headerText.indexOf("试验间登录"));
    expect(headerText.indexOf("试验间登录")).toBeLessThan(headerText.indexOf("显示弹窗"));
    expect(resetButton?.classList.contains("action-btn")).toBe(true);
    expect(resetButton?.classList.contains("laboratory-reset-button")).toBe(true);
    expect(headerActions.querySelector('[data-testid="laboratory-attendance-login"]')?.hasAttribute("disabled")).toBe(false);
    expect(headerActions.querySelector('[data-testid="laboratory-attendance-logout"]')).toBeNull();
  });

  test("keeps laboratory logout inside the login modal and disables it when no employee is logged in", async () => {
    attendanceSessionState = {
      active: false,
      employeeName: "",
      labName: "盐雾试验室",
      loggedInAt: null,
      username: "",
    };
    await mountPage();

    headerActions.querySelector('[data-testid="laboratory-attendance-login"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    const logoutButton = document.body.querySelector('[data-testid="laboratory-attendance-modal-logout"]');
    expect(logoutButton).toBeTruthy();
    expect(logoutButton?.hasAttribute("disabled")).toBe(true);
  });

  test("opens the laboratory attendance login modal in QR scan mode by default", async () => {
    attendanceSessionState = {
      active: false,
      employeeName: "",
      labName: "盐雾试验室",
      loggedInAt: null,
      username: "",
    };
    await mountPage();

    headerActions.querySelector('[data-testid="laboratory-attendance-login"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(document.body.querySelector('[data-testid="laboratory-attendance-qr-input"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="laboratory-attendance-qr-submit"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="laboratory-attendance-username"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="laboratory-attendance-login-submit"]')).toBeNull();
  });

  test("logs in to the laboratory by scanning an employee QR code", async () => {
    attendanceSessionState = {
      active: false,
      employeeName: "",
      labName: "盐雾试验室",
      username: "",
    };
    await mountPage();

    headerActions.querySelector('[data-testid="laboratory-attendance-login"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    const qrInput = document.body.querySelector('[data-testid="laboratory-attendance-qr-input"]');
    qrInput.value = "MES-ATTENDANCE:QR:test-token-001";
    qrInput.dispatchEvent(new Event("input", { bubbles: true }));
    document.body.querySelector('[data-testid="laboratory-attendance-qr-submit"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPageUpdates();

    expect(attendanceQrLoginCalls()).toHaveLength(1);
    expect(attendanceQrLoginCalls()[0][0]).toBe("/api/attendance/labs/%E7%9B%90%E9%9B%BE%E8%AF%95%E9%AA%8C%E5%AE%A4/login/qr");
    expect(JSON.parse(attendanceQrLoginCalls()[0][1].body)).toEqual({
      qrPayload: "MES-ATTENDANCE:QR:test-token-001",
    });
    expect(attendanceSessionState.username).toBe("qr-worker");
    expect(document.body.querySelector('[data-testid="laboratory-attendance-login-modal"].is-open')).toBeFalsy();
  });

  test("opens the attendance login modal above the running experiment modal when completing an axis without login", async () => {
    attendanceSessionState = {
      active: false,
      employeeName: "",
      labName: "盐雾试验室",
      loggedInAt: null,
      username: "",
    };
    snapshotState[STORAGE_KEYS.schedules] = (snapshotState[STORAGE_KEYS.schedules] || []).map((schedule) =>
      schedule.id === "schedule-1" ? { ...schedule, status: "实验进行中" } : schedule,
    );
    snapshotState[STORAGE_KEYS.experiments] = (snapshotState[STORAGE_KEYS.experiments] || []).map((experiment) =>
      experiment.experiment_code === "SYLU-2026-04-101-A" ? { ...experiment, axis_codes: ["x+"], status: "实验进行中" } : experiment,
    );
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    addActiveExperimentRun({ trayCodes: ["TP-001"], status: "实验进行中" });
    snapshotState[STORAGE_KEYS.experiment_run_steps] = [
      {
        run_no: "run-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        axis_code: "x+",
        step_no: 1,
        status: "实验进行中",
      },
    ];

    await mountPage();
    document.body.querySelector('[data-testid="laboratory-complete-axis-continue"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPageUpdates();

    const loginModal = document.body.querySelector('[data-testid="laboratory-attendance-login-modal"]');
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeTruthy();
    expect(loginModal).toBeTruthy();
    expect(loginModal?.parentElement).toBe(document.body);
    expect(loginModal?.classList.contains("laboratory-attendance-login-modal--priority")).toBe(true);
    expect(loginModal?.textContent || "").toContain("当前试验正在进行，请先登录人员后继续操作");
  });

  test("logs out the current laboratory employee from the login modal", async () => {
    attendanceSessionState = {
      active: true,
      employeeName: "张三",
      labName: "盐雾试验室",
      loggedInAt: "2026-04-02T09:00:00Z",
      username: "zhangsan",
      workStartedAt: null,
    };
    await mountPage();

    expect(headerActions.querySelector('[data-testid="laboratory-attendance-logout"]')).toBeNull();
    headerActions.querySelector('[data-testid="laboratory-attendance-login"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    const logoutButton = document.body.querySelector('[data-testid="laboratory-attendance-modal-logout"]');
    expect(logoutButton?.hasAttribute("disabled")).toBe(false);

    logoutButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPageUpdates();

    expect(attendanceLogoutCalls()).toHaveLength(1);
  });

  test("hides the standalone attendance logout action while an experiment is running", async () => {
    attendanceSessionState = {
      active: true,
      employeeName: "张三",
      labName: "盐雾试验室",
      loggedInAt: "2026-04-02T09:00:00Z",
      username: "zhangsan",
      workStartedAt: "2026-04-02T09:30:00Z",
    };
    snapshotState[STORAGE_KEYS.schedules] = (snapshotState[STORAGE_KEYS.schedules] || []).map((schedule) =>
      schedule.id === "schedule-1" ? { ...schedule, status: "实验进行中" } : schedule,
    );
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    addActiveExperimentRun({ trayCodes: ["TP-001"], status: "实验进行中" });
    await mountPage();

    headerActions.querySelector('[data-testid="laboratory-attendance-login"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    const loginModal = document.body.querySelector('[data-testid="laboratory-attendance-login-modal"]');
    expect(loginModal?.textContent || "").toContain("当前试验正在进行，仅允许切换登录人员");
    expect(document.body.querySelector('[data-testid="laboratory-attendance-modal-logout"]')).toBeNull();
    expect(attendanceLogoutCalls()).toHaveLength(0);
  });

  test("keeps login actions without a duplicate footer cancel button", async () => {
    attendanceSessionState = {
      active: true,
      employeeName: "张三",
      labName: "盐雾试验室",
      loggedInAt: "2026-04-02T09:00:00Z",
      username: "zhangsan",
      workStartedAt: null,
    };
    await mountPage();

    headerActions.querySelector('[data-testid="laboratory-attendance-login"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    const footerButtons = Array.from(document.body.querySelectorAll('[data-testid="laboratory-attendance-login-modal"] .form-actions button'))
      .map((button) => button.getAttribute("data-testid") || String(button.textContent || "").trim());
    expect(footerButtons).toEqual([
      "laboratory-attendance-modal-logout",
      "laboratory-attendance-qr-submit",
    ]);
  });

  test("keeps protected action labels and opens employee login before comparing when unauthenticated", async () => {
    attendanceSessionState = {
      active: false,
      employeeName: "",
      labName: "盐雾试验室",
      loggedInAt: null,
      username: "",
    };
    await mountPage();

    const viewTasksButton = document.body.querySelector('[data-testid="laboratory-view-tasks"]');
    const compareButton = document.body.querySelector('[data-testid="laboratory-compare"]');
    const installButton = document.body.querySelector('[data-testid="laboratory-install"]');
    const readyButton = document.body.querySelector('[data-testid="laboratory-ready"]');
    expect(viewTasksButton?.tagName).toBe("BUTTON");
    expect(String(viewTasksButton?.textContent || "").trim()).toBe("查看任务");
    expect(String(compareButton?.textContent || "").trim()).toBe("比对任务");
    expect(String(installButton?.textContent || "").trim()).toBe("安装样品");
    expect(String(readyButton?.textContent || "").trim()).toBe("确认准备就绪");

    compareButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(document.body.querySelector('[data-testid="laboratory-attendance-login-modal"]')).toBeTruthy();
    expect(document.body.querySelector('[data-testid="laboratory-compare-modal"].is-open')).toBeFalsy();
    expect(String(compareButton?.textContent || "").trim()).toBe("比对任务");
  });

  test("locks laboratory actions when the selected lab is under maintenance", async () => {
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.devices]: [
        { code: "盐雾试验室", name: "盐雾试验室", status: "维修" },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-101-SP-001",
          location: "盐雾试验室",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).toContain("设备维修中，禁止实验室操作");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
  });

  test("locks laboratory actions during the selected lab maintenance window", async () => {
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.devices]: [
        {
          code: "盐雾试验室",
          name: "盐雾试验室",
          maintenance_end_at: "2026-04-02T10:30:00.000Z",
          maintenance_start_at: "2026-04-02T09:30:00.000Z",
          maintenance_type: "计划保养",
          status: "可用",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).toContain("设备维修中，禁止实验室操作");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
  });

  test("uses the laboratory query to render and publish commands for a non-salt workbench", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.samples]: [
        ...createSnapshot()[STORAGE_KEYS.samples],
        {
          code: "SYLU-2026-04-501-SP-001",
          location: "冲击一室",
          owner: "周工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-501",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-CJ-001" }],
        },
      ],
      [STORAGE_KEYS.tasks]: [
        ...createSnapshot()[STORAGE_KEYS.tasks],
        { code: "SYLU-2026-04-501", name: "冲击连接器", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        ...createSnapshot()[STORAGE_KEYS.experiments],
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", experiment_name: "冲击试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        ...createSnapshot()[STORAGE_KEYS.experiment_trays],
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", tray_code: "TP-CJ-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        ...createSnapshot()[STORAGE_KEYS.schedules],
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-04-501",
          experiment_code: "SYLU-2026-04-501-A",
          device: "冲击一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).not.toContain("冲击一室操作台");
    expect(mounted.text()).not.toContain("任务与实验准备流程按现有项目数据口径展示");
    expect(mounted.text()).toContain("SYLU-2026-04-501");
    expect(mounted.text()).not.toContain("SYLU-2026-04-101");

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-CJ-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await flushPageUpdates();

    const fixtureInstallCall = await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    expect(JSON.parse(String(fixtureInstallCall[1].body))).toEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-501-A",
      lab_code: "LAB_IMPACT_1",
      sample_count: 1,
      sample_type: "",
      task_code: "SYLU-2026-04-501",
    }));
    snapshotState[STORAGE_KEYS.samples] = snapshotState[STORAGE_KEYS.samples].map((sample) =>
      sample.task_code === "SYLU-2026-04-501"
        ? {
            ...sample,
            trays: sample.trays.map((tray) =>
              tray.tray_code === "TP-CJ-001" ? { ...tray, fixtureReady: true, fixture_ready: true } : tray,
            ),
          }
        : sample,
    );
    const expectedStorageGetCalls = storageGetCalls().length + 1;
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await waitForStorageGetCount(expectedStorageGetCalls, { advanceStorageDebounce: true });
    await flushPageUpdates(12);
    vi.advanceTimersByTime(1000);
    await flushPageUpdates();
    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await flushPageUpdates();

    const readyCall = await waitForLaboratoryMqCall("/api/mq/laboratory/ready");
    expect(readyCall).toBeDefined();
    expect(JSON.parse(String(readyCall[1].body))).toEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-501-A",
      lab_code: "LAB_IMPACT_1",
      task_code: "SYLU-2026-04-501",
    }));
    expect(window.localStorage.setItem).toHaveBeenCalledWith("mes_laboratory_selected_lab_v1", "冲击一室");
  });

  test("publishes ready command with current schedule and axis context for an axis experiment", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "冲击二室" };
    masterLabsState = [
      { code: "LAB_IMPACT_2", name: "冲击二室", type: "实验室", testTypeName: "冲击试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-021", name: "冲击轴向任务", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          experiment_name: "冲击试验",
          axis_codes: ["x+", "x-", "z-"],
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "TP-AXIS-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact-axis-x-plus",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "冲击二室",
          axis_codes: ["x+", "x-"],
          axis_batch_no: "axis-batch-20260621",
          sub_experiment_code: "axis-batch-20260621",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
          status: "已排程",
        },
        {
          id: "schedule-impact-axis-z-minus",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "冲击二室",
          axis_codes: ["z-"],
          start_at: "2026-04-02T11:00:00.000Z",
          end_at: "2026-04-02T11:30:00.000Z",
          status: "已排程",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-021-SP-001",
          location: "冲击二室",
          owner: "周工",
          status: "工装夹具安装",
          flow_status: "工装夹具安装",
          task_code: "SYLU-2026-06-021",
          trays: [{ fixtureReady: true, fixture_ready: true, quantity: 1, status: "工装夹具安装", tray_code: "TP-AXIS-001" }],
        },
      ],
    };

    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await flushPageUpdates();

    const readyOperation = laboratoryOperationCalls()
      .map(([, options]) => JSON.parse(String(options.body || "{}")))
      .find((body) => body.operationType === "ready");
    expect(readyOperation).toEqual(expect.objectContaining({
      experimentCode: "SYLU-2026-06-021-A",
      subExperimentCode: "axis-batch-20260621",
      taskCode: "SYLU-2026-06-021",
    }));
    const readyCall = await waitForLaboratoryMqCall("/api/mq/laboratory/ready");
    expect(JSON.parse(String(readyCall[1].body))).toEqual(expect.objectContaining({
      axis_batch_no: "axis-batch-20260621",
      axis_codes: ["x+", "x-"],
      current_axis_code: "x+",
      experiment_code: "SYLU-2026-06-021-A",
      lab_code: "LAB_IMPACT_2",
      schedule_id: "schedule-impact-axis-x-plus",
      sub_experiment_code: "axis-batch-20260621",
      task_code: "SYLU-2026-06-021",
    }));
  });

  test("resends ready for the selected remaining axis schedule without persisting ready again", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
    ];
    const taskCode = "SYLU-2026-07-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const completedAxisCodes = ["x+", "x-", "y+"];
    const remainingAxisCodes = ["y-", "z+", "z-"];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: taskCode, name: "13652", status: "任务已完成", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          status: "实验已完成",
          axis_codes: [...completedAxisCodes, ...remainingAxisCodes],
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "run-impact-completed",
          run_no: "run-impact-completed",
          schedule_id: "schedule-impact-completed",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          status: "实验已完成",
          axis_codes: completedAxisCodes,
          tray_codes: [trayCode],
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: completedAxisCodes.map((axisCode, index) => ({
        id: `step-${axisCode}`,
        run_no: "run-impact-completed",
        task_code: taskCode,
        experiment_code: experimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
      [STORAGE_KEYS.experiment_run_trays]: [
        {
          run_no: "run-impact-completed",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: trayCode,
          status: "实验已完成",
          run_tray_status: "实验已完成",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验准备就绪",
          location: "冲击一室",
          status: "实验准备就绪",
          task_code: taskCode,
          trays: [
            {
              quantity: 1,
              status: "实验准备就绪",
              target_experiment_code: experimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact-completed",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-26 08:00:00",
          end_at: "2026-06-26 11:30:00",
          status: "实验已完成",
          axis_codes: completedAxisCodes,
        },
        {
          id: "schedule-impact-remaining",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-26 12:00:00",
          end_at: "2026-06-26 15:30:00",
          status: "实验已完成",
          axis_codes: remainingAxisCodes,
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.get('[data-testid="laboratory-ready"]').text()).toContain("重新下发准备");
    const operationCountBefore = laboratoryOperationCalls().length;
    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await flushPageUpdates();

    const readyCall = await waitForLaboratoryMqCall("/api/mq/laboratory/ready");
    expect(laboratoryOperationCalls()).toHaveLength(operationCountBefore);
    expect(JSON.parse(String(readyCall[1].body))).toEqual(expect.objectContaining({
      axis_codes: remainingAxisCodes,
      current_axis_code: "y-",
      experiment_code: experimentCode,
      lab_code: "LAB_IMPACT_1",
      schedule_id: "schedule-impact-remaining",
      task_code: taskCode,
    }));
  });

  test("resends ready without an operation write when axis progress is unavailable", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-07-001", name: "13652", status: "任务已完成", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-07-001",
          experiment_code: "SYLU-2026-07-001-A",
          experiment_name: "冲击试验",
          status: "实验已完成",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-07-001", experiment_code: "SYLU-2026-07-001-A", tray_code: "SYLU-2026-07-001-TP-001" },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-07-001-SP-001",
          flow_status: "实验准备就绪",
          location: "冲击一室",
          status: "实验准备就绪",
          task_code: "SYLU-2026-07-001",
          trays: [
            {
              quantity: 1,
              status: "实验准备就绪",
              target_experiment_code: "SYLU-2026-07-001-A",
              target_lab: "冲击一室",
              tray_code: "SYLU-2026-07-001-TP-001",
            },
          ],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact-ready",
          task_code: "SYLU-2026-07-001",
          experiment_code: "SYLU-2026-07-001-A",
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-26 12:00:00",
          end_at: "2026-06-26 15:30:00",
          status: "实验已完成",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.get('[data-testid="laboratory-ready"]').text()).toContain("重新下发准备");
    const operationCountBefore = laboratoryOperationCalls().length;
    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await flushPageUpdates();

    const readyCall = await waitForLaboratoryMqCall("/api/mq/laboratory/ready");
    expect(laboratoryOperationCalls()).toHaveLength(operationCountBefore);
    expect(readyCall).toBeDefined();
  });

  test("falls back to the known lab code for a non-salt workbench when master labs are unavailable", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-502-SP-001",
          location: "冲击一室",
          owner: "周工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-502",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-CJ-002" }],
        },
      ],
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-04-502", name: "冲击连接器-兜底", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        { task_code: "SYLU-2026-04-502", experiment_code: "SYLU-2026-04-502-A", experiment_name: "冲击试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-04-502", experiment_code: "SYLU-2026-04-502-A", tray_code: "TP-CJ-002" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact-fallback",
          task_code: "SYLU-2026-04-502",
          experiment_code: "SYLU-2026-04-502-A",
          device: "冲击一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).not.toContain("冲击一室操作台");
    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-CJ-002");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await flushPageUpdates();

    const fixtureInstallCall = await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    expect(JSON.parse(String(fixtureInstallCall[1].body))).toEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-502-A",
      lab_code: "LAB_IMPACT_1",
      task_code: "SYLU-2026-04-502",
    }));
  });

  test("publishes laboratory MQ calls in fixed MQTT mode", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await flushPageUpdates();

    const fixtureInstallCall = await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    expect(JSON.parse(String(fixtureInstallCall[1].body || "{}"))).toEqual(expect.objectContaining({
      lab_code: "LAB_SALT",
      task_code: "SYLU-2026-04-101",
    }));
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "工装夹具安装",
      status: "工装夹具安装",
    }));
  });

  test("resyncs the MQTT subscriber when host interface mode changes while laboratory page stays open", async () => {
    let hostInterfaceMode = null;
    window.localStorage.getItem.mockImplementation((key) => (key === HOST_INTERFACE_MODE_STORAGE_KEY ? hostInterfaceMode : null));
    window.localStorage.setItem.mockImplementation((key, value) => {
      if (key === HOST_INTERFACE_MODE_STORAGE_KEY) {
        hostInterfaceMode = value;
      }
    });
    const mounted = await mountPage();
    expect(mounted.text()).not.toContain("盐雾试验室操作台");
    const callsBeforeSwitch = interfaceModeCalls().length;

    writeHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    await flushPageUpdates();

    expect(interfaceModeCalls()).toHaveLength(callsBeforeSwitch + 1);
    expect(JSON.parse(String(interfaceModeCalls().at(-1)?.[1]?.body))).toEqual({ mode: HOST_INTERFACE_MODES.mqtt });
  });

  test("renders the salt-spray laboratory console and excludes other laboratory tasks", async () => {
    const mounted = await mountPage();

    expect(mounted.text()).not.toContain("盐雾试验室操作台");
    expect(mounted.text()).not.toContain("今日实验排程数量");
    expect(mounted.text()).not.toContain("今日未做实验数量");
    expect(mounted.text()).toContain("SYLU-2026-04-101");
    expect(mounted.text()).toContain("盐雾试验-A");
    expect(mounted.text()).toContain(toDisplayedDateTime("2026-04-02T09:30:00.000Z"));
    expect(mounted.text()).toContain(toDisplayedDateTime("2026-04-02T11:00:00.000Z"));
    expect(mounted.text()).not.toContain("SYLU-2026-04-102");
    expect(resetTaskButton()).toBeTruthy();
    expect(resetTaskButton()?.textContent || "").toContain("重置试验室任务");
    expect(mounted.find(".laboratory-control-header").exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    expect(mounted.get(".laboratory-recent-task__head").text()).toContain("SYLU-2026-04-101");
  });

  test("uses the canonical salt-spray master lab to filter laboratory schedules", async () => {
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室（东区）", type: "实验室", testTypeName: "盐雾试验", status: 1 },
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-001", name: "盐雾东区任务", test_type: "盐雾试验" },
        { code: "SYLU-2026-06-002", name: "旧盐雾任务", test_type: "盐雾试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", experiment_name: "盐雾试验" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-A", experiment_name: "盐雾试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-001", experiment_code: "SYLU-2026-06-001-A", tray_code: "TP-SALT-2" },
        { task_code: "SYLU-2026-06-002", experiment_code: "SYLU-2026-06-002-A", tray_code: "TP-SALT-OLD" },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-001-SP-001",
          location: "盐雾试验室（东区）",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-06-001",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-SALT-2" }],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-master-salt",
          task_code: "SYLU-2026-06-001",
          experiment_code: "SYLU-2026-06-001-A",
          device: "盐雾试验室（东区）",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-old-salt",
          task_code: "SYLU-2026-06-002",
          experiment_code: "SYLU-2026-06-002-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T12:00:00.000Z",
          end_at: "2026-04-02T13:00:00.000Z",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).not.toContain("盐雾试验室（东区）操作台");
    expect(mounted.text()).toContain("SYLU-2026-06-001");
    expect(mounted.text()).not.toContain("SYLU-2026-06-002");
  });

  test("disables comparison and shows guidance when the salt-spray lab has no tasks", async () => {
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.schedules]: [],
    };
    const mounted = await mountPage();

    expect(mounted.text()).toContain("当前盐雾试验室暂无任务");
    expect(mounted.text()).toContain("请先在排程看板安排任务");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    await nextTick();

    expect(mounted.get('[data-testid="laboratory-task-list-modal"]').text()).toContain("当前实验室暂无任务");
  });

  test("disables comparison when every scheduled tray is still before laboratory dispatch", async () => {
    const mounted = await mountPage();

    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);
  });

  test("reloads flow state when sample progress changes are broadcast", async () => {
    await mountPage();

    expect(storageGetCalls()).toHaveLength(1);

    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.samples]: snapshotState[STORAGE_KEYS.samples].map((sample) =>
        sample.task_code === "SYLU-2026-04-101"
          ? {
              ...sample,
              status: "工装夹具安装",
              trays: sample.trays.map((tray) => ({ ...tray, status: "工装夹具安装" })),
            }
          : sample,
      ),
    };

    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await waitForStorageGetCount(2);

    expect(storageGetCalls()).toHaveLength(2);
  });

  test("does not teleport any schedule button into the laboratory header actions", async () => {
    const mounted = await mountPage();

    const scheduleButton = document.body.querySelector('[data-testid="laboratory-open-schedule"]');
    expect(scheduleButton).toBeNull();

    const headerButtons = Array.from(headerActions.querySelectorAll("button")).map((button) => String(button.textContent || "").trim());
    expect(headerButtons).toContain("刷新");
    expect(headerButtons).toContain("退出登录");
    expect(headerButtons).not.toContain("查看排程");
    expect(mounted.find('[data-testid="laboratory-schedule-modal"].is-open').exists()).toBe(false);
  });

  test("shows a disabled header display-modal button when no experiment is running", async () => {
    await mountPage();

    const displayButton = document.body.querySelector('[data-testid="laboratory-show-running-modal"]');
    const logoutButton = document.body.querySelector('[data-testid="app-logout"]');
    const headerButtons = Array.from(headerActions.querySelectorAll("button")).map((button) => String(button.textContent || "").trim());

    expect(headerButtons).toEqual(["刷新", "重置试验室任务", "切换登录", "显示弹窗", "退出登录"]);
    expect(displayButton?.getAttribute("disabled")).not.toBeNull();
    expect(displayButton?.previousElementSibling?.textContent || "").toContain("切换登录");
    expect(logoutButton?.previousElementSibling?.querySelector('[data-testid="laboratory-show-running-modal"]')).toBe(displayButton);
  });

  test("mounts the header display-modal button when the page and shell render together", async () => {
    await mountPageInsideShell();

    const displayButton = document.body.querySelector('[data-testid="laboratory-show-running-modal"]');
    const logoutButton = document.body.querySelector('[data-testid="app-logout"]');

    expect(displayButton?.textContent?.trim()).toBe("显示弹窗");
    expect(displayButton?.getAttribute("disabled")).not.toBeNull();
    expect(logoutButton?.previousElementSibling?.querySelector('[data-testid="laboratory-show-running-modal"]')).toBe(displayButton);
  });

  test("shows detailed task rows, allows selecting the next task, and updates the current task after confirmation", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");

    expect(mounted.find('[data-testid="laboratory-task-list-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-task-row-SYLU-2026-04-101"]').classes()).toContain("is-current");
    expect(mounted.text()).toContain("TP-001");
    expect(mounted.text()).toContain("TP-002");
    expect(mounted.text()).toContain("TP-101");
    expect(mounted.text()).toContain(toDisplayedTime("2026-04-02T12:00:00.000Z"));
    expect(mounted.text()).toContain(toDisplayedTime("2026-04-02T13:00:00.000Z"));

    await mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-task-row-SYLU-2026-04-201"]').classes()).toContain("is-pending");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");

    expect(mounted.text()).toContain("SYLU-2026-04-201 / 盐雾试验-B");
    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-task-row-SYLU-2026-04-201"]').classes()).toContain("is-current");
  });

  test("switches a recent task only after direct-click confirmation and keeps the current task on cancel", async () => {
    const mounted = await mountPage();
    const currentTaskButton = mounted.get('[data-testid="laboratory-recent-task-SYLU-2026-04-101"]');
    const nextTaskButton = mounted.get('[data-testid="laboratory-recent-task-SYLU-2026-04-201"]');

    expect(currentTaskButton.attributes("disabled")).toBeDefined();
    expect(nextTaskButton.attributes("disabled")).toBeUndefined();

    await nextTaskButton.trigger("click");
    expect(mounted.get('[data-testid="laboratory-recent-task-confirm-modal"]').classes()).toContain("is-open");
    expect(mounted.get('[data-testid="laboratory-recent-task-confirm-modal"]').text()).toContain(
      "是否要将当前任务更改为 SYLU-2026-04-201",
    );

    await mounted.get('[data-testid="laboratory-recent-task-cancel"]').trigger("click");
    expect(mounted.find('[data-testid="laboratory-recent-task-confirm-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-tray-flow"]').text()).toContain("SYLU-2026-04-101 / 盐雾试验-A");

    await nextTaskButton.trigger("click");
    await mounted.get('[data-testid="laboratory-recent-task-confirm"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.find('[data-testid="laboratory-recent-task-confirm-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-tray-flow"]').text()).toContain("SYLU-2026-04-201 / 盐雾试验-B");
    expect(mounted.get('[data-testid="laboratory-recent-task-SYLU-2026-04-201"]').attributes("disabled")).toBeDefined();
  });

  test("blocks switching schedules of the same experiment after comparison", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-021", name: "振动多轴任务", test_type: "振动试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          experiment_name: "振动试验",
          status: "已排程",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-021", experiment_code: "SYLU-2026-06-021-A", tray_code: "SYLU-2026-06-021-TP-001" },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-021-SP-001",
          flow_status: "已到达实验室",
          location: "振动一室",
          owner: "周工",
          status: "已到达实验室",
          task_code: "SYLU-2026-06-021",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "SYLU-2026-06-021-TP-001" }],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-axis-1",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "振动一室",
          axis_codes: ["y+", "z+"],
          start_at: "2026-06-24T18:35:00",
          end_at: "2026-06-24T20:35:00",
          status: "已排程",
        },
        {
          id: "schedule-axis-2",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "振动一室",
          axis_codes: ["x+"],
          start_at: "2026-06-25T08:00:00",
          end_at: "2026-06-25T12:00:00",
          status: "已排程",
        },
        {
          id: "schedule-axis-3",
          task_code: "SYLU-2026-06-021",
          experiment_code: "SYLU-2026-06-021-A",
          device: "振动一室",
          axis_codes: ["x-", "y-", "z-"],
          start_at: "2026-06-25T12:00:00",
          end_at: "2026-06-25T18:00:00",
          status: "已排程",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.findAll(".laboratory-recent-task")).toHaveLength(3);
    expect(mounted.findAll(".laboratory-recent-task.is-current")).toHaveLength(1);

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    const taskRows = mounted.findAll(".laboratory-task-list-row");
    expect(taskRows).toHaveLength(3);
    expect(mounted.findAll(".laboratory-task-list-row.is-current")).toHaveLength(1);
    expect(taskRows.map((row) => row.find("button").text()).filter((text) => text.includes("已选中"))).toHaveLength(1);

    const nextScheduleButton = taskRows[1].find("button");
    expect(nextScheduleButton.attributes("disabled")).toBeDefined();
    await nextScheduleButton.trigger("click");
    expect(mounted.findAll(".laboratory-task-list-row.is-pending")).toHaveLength(0);
    expect(taskRows.map((row) => row.find("button").text()).filter((text) => text.includes("已选中"))).toHaveLength(1);
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");

    expect(mounted.findAll(".laboratory-recent-task.is-current")).toHaveLength(1);
    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    expect(mounted.findAll(".laboratory-task-list-row.is-current")).toHaveLength(1);
  });

  test("does not keep a completed axis batch as the current laboratory task", async () => {
    vi.setSystemTime(new Date("2026-06-25T15:30:00+08:00"));
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
    ];
    const taskCode = "SYLU-2026-07-001";
    const experimentCode = `${taskCode}-A`;
    const trayCode = `${taskCode}-TP-001`;
    const completedAxisCodes = ["x+", "x-", "y+", "y-"];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: taskCode, name: "13652", status: "任务已完成", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: taskCode,
          experiment_code: experimentCode,
          experiment_name: "冲击试验",
          status: "实验已完成",
          axis_codes: [...completedAxisCodes, "z+", "z-"],
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: taskCode, experiment_code: experimentCode, tray_code: trayCode },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "run-impact-xy",
          run_no: "run-impact-xy",
          schedule_id: "schedule-impact-xy",
          task_code: taskCode,
          experiment_code: experimentCode,
          device: "冲击一室",
          status: "实验已完成",
          axis_codes: completedAxisCodes,
          tray_codes: [trayCode],
          started_at: "2026-06-25 15:09:29",
          ended_at: "2026-06-25 15:14:11",
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: completedAxisCodes.map((axisCode, index) => ({
        id: String(332 + index),
        run_no: "run-impact-xy",
        task_code: taskCode,
        experiment_code: experimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
      })),
      [STORAGE_KEYS.experiment_run_trays]: [
        {
          run_no: "run-impact-xy",
          task_code: taskCode,
          experiment_code: experimentCode,
          tray_code: trayCode,
          status: "实验已完成",
          run_tray_status: "实验已完成",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "实验进行中",
          location: "冲击一室",
          status: "实验进行中",
          task_code: taskCode,
          trays: [
            {
              fixtureReady: false,
              fixture_ready: false,
              quantity: 1,
              status: "实验进行中",
              target_experiment_code: experimentCode,
              target_lab: "冲击一室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact-xy",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-25 15:08:00",
          end_at: "2026-06-25 18:38:00",
          status: "实验已完成",
          axis_codes: completedAxisCodes,
        },
        {
          id: "schedule-impact-z",
          task_code: taskCode,
          experiment_code: experimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-06-26 08:00:00",
          end_at: "2026-06-26 11:30:00",
          status: "实验已完成",
          axis_codes: ["z+", "z-"],
        },
      ],
    };

    const mounted = await mountPage();
    const recentTasks = mounted.findAll(".laboratory-recent-task");

    expect(recentTasks).toHaveLength(1);
    expect(recentTasks[0].text()).toContain("轴向：z+、z-");
    expect(recentTasks[0].text()).not.toContain("轴向：x+、x-、y+、y-");
    expect(mounted.findAll(".laboratory-recent-task.is-current")).toHaveLength(1);
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').text()).not.toContain("重新下发准备");
    expect(mounted.find('[data-testid="laboratory-task-flow"]').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toContain(`当前托盘：${trayCode}`);
    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toContain("冲击试验部分完成 4/6轴");
    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).not.toContain("样品运输中");
  });

  test("shows tray flow for a remaining impact axis schedule while the tray is dispatched to mold", async () => {
    vi.setSystemTime(new Date("2026-07-03T21:30:00+08:00"));
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
      { code: "LAB_MOLD", name: "霉菌试验室", type: "实验室", testTypeName: "霉菌试验", status: 1 },
    ];
    const taskCode = "SYLU-2026-07-021";
    const trayCode = `${taskCode}-TP-001`;
    const impactExperimentCode = `${taskCode}-A`;
    const moldExperimentCode = `${taskCode}-B`;
    const completedSubExperimentCode = `${impactExperimentCode}-AXIS-001`;
    const remainingSubExperimentCode = `${impactExperimentCode}-AXIS-002`;
    const completedAxisCodes = ["x+", "x-", "y+", "y-"];
    const remainingAxisCodes = ["z+", "z-"];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: taskCode, name: "测试实验07021", status: "任务进行中", test_type: "冲击试验 / 霉菌试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          experiment_name: "冲击试验",
          status: "实验进行中",
          axis_codes: [...completedAxisCodes, ...remainingAxisCodes],
        },
        {
          task_code: taskCode,
          experiment_code: moldExperimentCode,
          experiment_name: "霉菌试验",
          status: "已排程",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: taskCode, experiment_code: impactExperimentCode, tray_code: trayCode },
        { task_code: taskCode, experiment_code: moldExperimentCode, tray_code: trayCode },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "run-impact-completed",
          run_no: "run-impact-completed",
          schedule_id: "schedule-impact-completed",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          device: "冲击一室",
          status: "实验已完成",
          axis_codes: completedAxisCodes,
          sub_experiment_code: completedSubExperimentCode,
          tray_codes: [trayCode],
          ended_at: "2026-07-03 21:21:51",
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: completedAxisCodes.map((axisCode, index) => ({
        id: `step-${axisCode}`,
        run_no: "run-impact-completed",
        task_code: taskCode,
        experiment_code: impactExperimentCode,
        axis_code: axisCode,
        step_no: index + 1,
        status: "实验已完成",
        sub_experiment_code: completedSubExperimentCode,
      })),
      [STORAGE_KEYS.experiment_run_trays]: [
        {
          run_no: "run-impact-completed",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          tray_code: trayCode,
          status: "实验已完成",
          run_tray_status: "实验已完成",
          sub_experiment_code: completedSubExperimentCode,
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: `${taskCode}-SP-001`,
          flow_status: "送至实验室",
          location: "霉菌试验室",
          status: "送至实验室",
          task_code: taskCode,
          trays: [
            {
              fixtureReady: false,
              fixture_ready: false,
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: moldExperimentCode,
              target_lab: "霉菌试验室",
              tray_code: trayCode,
            },
          ],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact-remaining",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-07-04 12:00:00",
          end_at: "2026-07-04 15:30:00",
          status: "已排程",
          axis_codes: remainingAxisCodes,
          sub_experiment_code: remainingSubExperimentCode,
        },
        {
          id: "schedule-mold",
          task_code: taskCode,
          experiment_code: moldExperimentCode,
          lab_code: "LAB_MOLD",
          device: "霉菌试验室",
          start_at: "2026-07-04 08:00:00",
          end_at: "2026-07-04 11:30:00",
          status: "已排程",
        },
        {
          id: "schedule-impact-completed",
          task_code: taskCode,
          experiment_code: impactExperimentCode,
          lab_code: "LAB_IMPACT_1",
          device: "冲击一室",
          start_at: "2026-07-04 08:00:00",
          end_at: "2026-07-04 11:30:00",
          status: "实验已完成",
          axis_codes: completedAxisCodes,
          sub_experiment_code: completedSubExperimentCode,
        },
      ],
    };

    const mounted = await mountPage();
    const recentTasks = mounted.findAll(".laboratory-recent-task");

    expect(recentTasks).toHaveLength(1);
    expect(recentTasks[0].text()).toContain(taskCode);
    expect(recentTasks[0].text()).toContain("轴向：z+、z-");
    expect(mounted.findAll(".laboratory-recent-task.is-current")).toHaveLength(1);
    expect(mounted.find(".laboratory-recent-task.is-current").text()).toContain("已选中");

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-select-task-SYLU-2026-07-021"]').text()).toBe("已选中");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.findAll(".laboratory-recent-task.is-current")).toHaveLength(1);
    expect(mounted.find(".laboratory-recent-task.is-current").text()).toContain("已选中");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-tray-tab-SYLU-2026-07-021-TP-001"]').text()).toBe(trayCode);
    expect(mounted.get('[data-testid="laboratory-tray-flow"]').text()).toContain(`${taskCode} / 冲击试验`);
    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toContain(`当前托盘：${trayCode}`);
    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).not.toContain("样品运输中");
    expect(mounted.get('[data-testid="laboratory-task-empty-hint"]').text()).toContain("当前托盘已送至霉菌试验室");
    expect(mounted.get('[data-testid="laboratory-task-empty-hint"]').text()).not.toContain("请先在查看任务中选择一个任务");
  });

  test("blocks switching away from a task that has completed comparison", async () => {
    snapshotState[STORAGE_KEYS.samples][0] = {
      ...snapshotState[STORAGE_KEYS.samples][0],
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [
        { quantity: 2, status: "送至实验室", tray_code: "TP-001" },
        { quantity: 2, status: "送至实验室", tray_code: "TP-002" },
      ],
    };
    snapshotState[STORAGE_KEYS.samples][1] = {
      ...snapshotState[STORAGE_KEYS.samples][1],
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-101" }],
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();

    const lockedRecentTask = mounted.get('[data-testid="laboratory-recent-task-SYLU-2026-04-201"]');
    expect(lockedRecentTask.attributes("disabled")).toBeDefined();
    await lockedRecentTask.trigger("click");
    expect(mounted.find('[data-testid="laboratory-recent-task-confirm-modal"].is-open').exists()).toBe(false);

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    const nextTaskButton = mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]');
    expect(nextTaskButton.attributes("disabled")).toBeDefined();
    await nextTaskButton.trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.text()).toContain("SYLU-2026-04-101 / 盐雾试验-A");
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await flushPageUpdates();
    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(true);
  });

  test("allows another main laboratory to compare a different tray while a different laboratory is operating", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-101-SP-001",
          flow_status: "已到达实验室",
          location: "盐雾试验室",
          owner: "王工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-001" }],
        },
        {
          code: "SYLU-2026-04-102-SP-001",
          flow_status: "送至实验室",
          location: "振动一室",
          owner: "李工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-102",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-201" }],
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", tray_code: "TP-201" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-salt-operating",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-vibration-candidate",
          task_code: "SYLU-2026-04-102",
          experiment_code: "SYLU-2026-04-102-A",
          device: "振动一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).toContain("SYLU-2026-04-102 / 振动试验");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-201");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeUndefined();
  });

  test("allows impact comparison for another tray in the same task while salt spray is running", async () => {
    reactiveRoute.query = { lab: "冲击二室" };
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
      { code: "LAB_IMPACT_2", name: "冲击二室", type: "实验室", testTypeName: "冲击试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-07-001", name: "冲击盐雾任务", test_type: "盐雾试验 / 冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-07-001",
          experiment_code: "SYLU-2026-07-001-A",
          experiment_name: "盐雾试验",
          status: "实验进行中",
        },
        {
          task_code: "SYLU-2026-07-001",
          experiment_code: "SYLU-2026-07-001-B",
          experiment_name: "冲击试验",
          status: "已排程",
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "run-salt-001",
          run_no: "run-salt-001",
          task_code: "SYLU-2026-07-001",
          experiment_code: "SYLU-2026-07-001-A",
          device: "盐雾试验室",
          tray_codes: ["SYLU-2026-07-001-TP-001"],
          status: "实验进行中",
          started_at: "2026-06-18 16:52:13",
        },
      ],
      [STORAGE_KEYS.experiment_run_trays]: [
        {
          run_no: "run-salt-001",
          task_code: "SYLU-2026-07-001",
          experiment_code: "SYLU-2026-07-001-A",
          tray_code: "SYLU-2026-07-001-TP-001",
          run_tray_status: "实验进行中",
          status: "实验进行中",
          started_at: "2026-06-18 16:52:13",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-07-001", experiment_code: "SYLU-2026-07-001-A", tray_code: "SYLU-2026-07-001-TP-001" },
        { task_code: "SYLU-2026-07-001", experiment_code: "SYLU-2026-07-001-B", tray_code: "SYLU-2026-07-001-TP-001" },
        { task_code: "SYLU-2026-07-001", experiment_code: "SYLU-2026-07-001-B", tray_code: "SYLU-2026-07-001-TP-002" },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-07-001-SP-001",
          flow_status: "实验进行中",
          location: "盐雾试验室",
          owner: "王工",
          status: "实验进行中",
          task_code: "SYLU-2026-07-001",
          trays: [
            {
              quantity: 1,
              status: "实验进行中",
              target_experiment_code: "SYLU-2026-07-001-A",
              target_lab: "盐雾试验室",
              tray_code: "SYLU-2026-07-001-TP-001",
            },
          ],
        },
        {
          code: "SYLU-2026-07-001-SP-002",
          flow_status: "送至实验室",
          history: [
            {
              action: "暂存间扫码出库",
              detail: "SYLU-2026-07-001-TP-002 送至 冲击二室",
              location: "冲击二室",
              status: "送至实验室",
              time: "2026-06-18 16:52:30",
            },
          ],
          location: "冲击二室",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-07-001",
          trays: [
            {
              quantity: 1,
              status: "送至实验室",
              target_experiment_code: "SYLU-2026-07-001-B",
              target_lab: "冲击二室",
              tray_code: "SYLU-2026-07-001-TP-002",
            },
          ],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact-001",
          task_code: "SYLU-2026-07-001",
          experiment_code: "SYLU-2026-07-001-B",
          device: "冲击二室",
          start_at: "2026-06-18 16:30:00",
          end_at: "2026-06-18 23:40:00",
        },
        {
          id: "schedule-salt-001",
          task_code: "SYLU-2026-07-001",
          experiment_code: "SYLU-2026-07-001-A",
          device: "盐雾试验室",
          start_at: "2026-06-18 16:30:00",
          end_at: "2026-06-18 23:40:00",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.text()).toContain("SYLU-2026-07-001 / 冲击试验");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("SYLU-2026-07-001-TP-002");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await flushPageUpdates();

    const installCall = laboratoryOperationCalls().find(([, options = {}]) => {
      const body = JSON.parse(String(options.body || "{}"));
      return body.operationType === "install";
    });
    expect(JSON.parse(String(installCall[1].body))).toEqual(expect.objectContaining({
      experimentCode: "SYLU-2026-07-001-B",
      operationType: "install",
      trayCodes: ["SYLU-2026-07-001-TP-002"],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][0].trays[0]).toEqual(expect.objectContaining({
      status: "实验进行中",
      tray_code: "SYLU-2026-07-001-TP-001",
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1].trays[0]).toEqual(expect.objectContaining({
      status: "工装夹具安装",
      tray_code: "SYLU-2026-07-001-TP-002",
    }));
  });

  test("does not overwrite another laboratory tray state when persisting comparison from a stale snapshot", async () => {
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-101-SP-001",
          flow_status: "送至实验室",
          location: "盐雾试验室",
          owner: "王工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
        },
        {
          code: "SYLU-2026-04-102-SP-001",
          flow_status: "送至实验室",
          location: "振动一室",
          owner: "李工",
          status: "送至实验室",
          task_code: "SYLU-2026-04-102",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-201" }],
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", tray_code: "TP-201" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-salt-candidate",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-vibration-candidate",
          task_code: "SYLU-2026-04-102",
          experiment_code: "SYLU-2026-04-102-A",
          device: "振动一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
    };

    const mounted = await mountPage();
    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.samples]: snapshotState[STORAGE_KEYS.samples].map((sample) =>
        sample.task_code === "SYLU-2026-04-102"
          ? {
              ...sample,
              flow_status: "已到达实验室",
              status: "已到达实验室",
              trays: sample.trays.map((tray) => ({ ...tray, status: "已到达实验室" })),
            }
          : sample,
      ),
    };

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    const vibrationSample = snapshotState[STORAGE_KEYS.samples].find((sample) => sample.task_code === "SYLU-2026-04-102");
    expect(vibrationSample).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-201" })],
    }));
  });

  test("publishes fixture installation for the selected laboratory while another laboratory has already started", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-101-SP-001",
          flow_status: "已到达实验室",
          location: "盐雾试验室",
          owner: "王工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-101",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-001" }],
        },
        {
          code: "SYLU-2026-04-102-SP-001",
          flow_status: "已到达实验室",
          location: "振动一室",
          owner: "李工",
          status: "已到达实验室",
          task_code: "SYLU-2026-04-102",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-201" }],
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
        { task_code: "SYLU-2026-04-102", experiment_code: "SYLU-2026-04-102-A", tray_code: "TP-201" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-salt-operating",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
        {
          id: "schedule-vibration-candidate",
          task_code: "SYLU-2026-04-102",
          experiment_code: "SYLU-2026-04-102-A",
          device: "振动一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
    };

    const mounted = await mountPage();

    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    const mqCall = await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    const payload = JSON.parse(String(mqCall[1]?.body || "{}"));

    expect(payload).toEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-102-A",
      lab_code: "LAB_VIBRATION_1",
      task_code: "SYLU-2026-04-102",
    }));
  });

  test("updates tray flow to laboratory arrival after comparing a partially completed axis tray", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-07-001", name: "振动轴向任务", test_type: "振动试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
          experiment_code: "SYLU-2026-07-001-VIB",
          experiment_name: "振动试验",
          task_code: "SYLU-2026-07-001",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        {
          experiment_code: "SYLU-2026-07-001-VIB",
          task_code: "SYLU-2026-07-001",
          tray_code: "SYLU-2026-07-001-TP-002",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-07-001-SP-002",
          flow_status: "振动试验部分完成 3/6轴",
          history: [
            {
              action: "实验完成",
              detail: "SYLU-2026-07-001 / 振动试验 / 振动试验部分完成 3/6轴",
              location: "振动一室",
              status: "振动试验部分完成 3/6轴",
              time: "2026-06-29 16:12:56",
              tray_code: "SYLU-2026-07-001-TP-002",
            },
          ],
          location: "振动一室",
          owner: "王工",
          status: "振动试验部分完成 3/6轴",
          task_code: "SYLU-2026-07-001",
          trays: [
            {
              quantity: 1,
              status: "振动试验部分完成 3/6轴",
              target_experiment_code: "SYLU-2026-07-001-VIB",
              target_lab: "振动一室",
              tray_code: "SYLU-2026-07-001-TP-002",
            },
          ],
        },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          axis_codes: ["y-", "z+", "z-"],
          device: "振动一室",
          experiment_code: "SYLU-2026-07-001-VIB",
          id: "schedule-vibration-rest",
          lab_code: "LAB_VIBRATION_1",
          start_at: "2026-06-30 12:00:00",
          task_code: "SYLU-2026-07-001",
        },
      ],
    };

    const mounted = await mountPage();

    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(true);
    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("SYLU-2026-07-001-TP-002");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toBe(
      "当前托盘：SYLU-2026-07-001-TP-002 | 当前状态：已到达实验室",
    );
    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(false);
  });

  test("collapses many task-list trays and opens a full tray detail modal", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiment_trays] = Array.from({ length: 7 }, (_, index) => ({
      task_code: "SYLU-2026-04-101",
      experiment_code: "SYLU-2026-04-101-A",
      tray_code: `TP-${String(index + 1).padStart(3, "0")}`,
    }));
    snapshotState[STORAGE_KEYS.samples] = snapshotState[STORAGE_KEYS.experiment_trays].map((entry, index) => ({
      code: `SYLU-2026-04-101-SP-${String(index + 1).padStart(3, "0")}`,
      location: "盐雾试验室",
      owner: "王工",
      status: "已到达实验室",
      task_code: "SYLU-2026-04-101",
      trays: [{ quantity: 1, status: "到货", tray_code: entry.tray_code }],
    }));

    const mounted = await mountPage();
    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");

    const currentRow = mounted.get('[data-testid="laboratory-task-row-SYLU-2026-04-101"]');
    const trayList = currentRow.get(".laboratory-task-tray-list");
    expect(trayList.findAll(".laboratory-tray-chip")).toHaveLength(3);
    expect(trayList.text()).toContain("+4");
    expect(trayList.text()).toContain("查看全部");
    expect(trayList.text()).not.toContain("TP-007");

    await currentRow.get('[data-testid="laboratory-task-row-show-all-SYLU-2026-04-101"]').trigger("click");

    expect(mounted.find('[data-testid="laboratory-full-content-modal"].is-open').exists()).toBe(true);
    expect(mounted.findAll("[data-testid^='laboratory-full-tray-row-']")).toHaveLength(7);
    expect(mounted.text()).toContain("TP-007");
    expect(mounted.text()).toContain("SYLU-2026-04-101-SP-007");
  });

  test("compares trays against the current task and shows green/red feedback", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples][0] = {
      ...snapshotState[STORAGE_KEYS.samples][0],
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: snapshotState[STORAGE_KEYS.samples][0].trays.map((tray) => ({
        ...tray,
        status: "送至实验室",
      })),
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-101");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对不正确");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("当前任务并非优先所选任务");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("盐雾试验室");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').attributes("data-tone")).toBe("error");
    expect(mounted.get('[data-testid="laboratory-compare-scan-input"]').element.value).toBe("");

    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').attributes("data-tone")).toBe("success");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeUndefined();
  });

  test("submits tray comparison when the scanner sends Enter", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples][0] = {
      ...snapshotState[STORAGE_KEYS.samples][0],
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: snapshotState[STORAGE_KEYS.samples][0].trays.map((tray) => ({
        ...tray,
        status: "送至实验室",
      })),
    };
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').trigger("keyup.enter");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeUndefined();
  });

  test("closes the compare modal after each completed tray during consecutive tray comparisons", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples][0] = {
      ...snapshotState[STORAGE_KEYS.samples][0],
      status: "送至实验室",
      flow_status: "送至实验室",
      trays: snapshotState[STORAGE_KEYS.samples][0].trays.map((tray) => ({
        ...tray,
        status: "送至实验室",
      })),
    };
    const operationWrites = [];
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      const attendanceResponse = handleAttendanceFetch(url, options);
      if (attendanceResponse) {
        return attendanceResponse;
      }
      if (url.includes("/api/laboratory/operations")) {
        return new Promise((resolve) => {
          operationWrites.push(() => resolve(handleLaboratoryOperationFetch(url, options)));
        });
      }
      if (url.includes("/api/storage")) {
        if ((options.method || "GET") === "PUT") {
          const payload = JSON.parse(String(options.body || "{}"));
          snapshotState = {
            ...snapshotState,
            ...payload,
          };
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => snapshotState };
      }
      if (url.includes("/api/mq/interface-mode")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, mode: HOST_INTERFACE_MODES.mqtt, subscriber_running: true }) };
      }
      if (url.includes("/api/mq/laboratory")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: true }) };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);
    await waitForQueueLength(operationWrites, 1);
    operationWrites.shift()();
    await flushPageUpdates();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-002");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(false);
    await waitForQueueLength(operationWrites, 1);
    operationWrites.shift()();
    await flushPageUpdates();
  });

  test("keeps the compared task in place and blocks selecting the next task", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T09:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T08:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [
          { quantity: 1, status: "送至实验室", tray_code: "TP-001" },
          { quantity: 1, status: "送至实验室", tray_code: "TP-002" },
        ],
      },
      {
        code: "SYLU-2026-04-201-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T11:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T10:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "李工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-201",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-101" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);

    expect(snapshotState[STORAGE_KEYS.samples][0].trays).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" }),
        expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" }),
      ]),
    );

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    const nextTaskButton = mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]');
    expect(nextTaskButton.attributes("disabled")).toBeDefined();
    await nextTaskButton.trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    expect(mounted.text()).toContain("SYLU-2026-04-101 / 盐雾试验-A");
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await nextTick();
    expect(mounted.find('[data-testid="laboratory-compare-modal"].is-open').exists()).toBe(true);

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      location: "盐雾试验室",
      status: "已到达实验室",
      trays: expect.arrayContaining([
        expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" }),
        expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" }),
      ]),
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-101" })],
    }));
  });

  test("keeps the first compared task locked when selecting through unprepared tasks", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      ...snapshotState[STORAGE_KEYS.tasks],
      { code: "SYLU-2026-04-401", name: "盐雾端子", test_type: "盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      ...snapshotState[STORAGE_KEYS.experiments],
      { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", experiment_name: "盐雾试验-C" },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      ...snapshotState[STORAGE_KEYS.experiment_trays],
      { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", tray_code: "TP-401" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      ...snapshotState[STORAGE_KEYS.schedules],
      {
        id: "schedule-6",
        task_code: "SYLU-2026-04-401",
        experiment_code: "SYLU-2026-04-401-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T14:30:00.000Z",
        end_at: "2026-04-02T15:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T09:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T08:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-201-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T11:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T10:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "李工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-201",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-101" }],
      },
      {
        code: "SYLU-2026-04-401-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T14:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T13:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "周工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-401",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-401" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    const secondTaskButton = mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]');
    expect(secondTaskButton.attributes("disabled")).toBeDefined();
    await secondTaskButton.trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    const thirdTaskButton = mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-401"]');
    expect(thirdTaskButton.attributes("disabled")).toBeDefined();
    await thirdTaskButton.trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    expect(mounted.text()).toContain("SYLU-2026-04-101 / 盐雾试验-A");
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      location: "盐雾试验室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      location: "盐雾试验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-101" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][2]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-401" })],
    }));
  });

  test("blocks additional compared tasks until the prepared task is reset", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      ...snapshotState[STORAGE_KEYS.tasks],
      { code: "SYLU-2026-04-401", name: "盐雾端子", test_type: "盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      ...snapshotState[STORAGE_KEYS.experiments],
      { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", experiment_name: "盐雾试验-C" },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      ...snapshotState[STORAGE_KEYS.experiment_trays],
      { task_code: "SYLU-2026-04-401", experiment_code: "SYLU-2026-04-401-A", tray_code: "TP-401" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      ...snapshotState[STORAGE_KEYS.schedules],
      {
        id: "schedule-6",
        task_code: "SYLU-2026-04-401",
        experiment_code: "SYLU-2026-04-401-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T14:30:00.000Z",
        end_at: "2026-04-02T15:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T09:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T08:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-201-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T11:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T10:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "李工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-201",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-101" }],
      },
      {
        code: "SYLU-2026-04-401-SP-001",
        flow_status: "送至实验室",
        history: [
          { action: "暂存间扫码出库", location: "盐雾试验室", status: "送至实验室", time: "2026-04-02T14:20:00.000Z" },
          { action: "暂存间扫码入库", location: "恒温恒湿间（暂存间）", status: "已到达暂存间", time: "2026-04-02T13:30:00.000Z" },
        ],
        location: "盐雾试验室",
        owner: "周工",
        status: "送至实验室",
        task_code: "SYLU-2026-04-401",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-401" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    const secondTaskButton = mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]');
    expect(secondTaskButton.attributes("disabled")).toBeDefined();
    await secondTaskButton.trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    expect(mounted.text()).toContain("SYLU-2026-04-101 / 盐雾试验-A");
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    const thirdTaskButton = mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-401"]');
    expect(thirdTaskButton.attributes("disabled")).toBeDefined();
    await thirdTaskButton.trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();

    expect(mounted.text()).toContain("SYLU-2026-04-101 / 盐雾试验-A");
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      location: "盐雾试验室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      location: "盐雾试验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-101" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][2]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: [expect.objectContaining({ status: "送至实验室", tray_code: "TP-401" })],
    }));
  });

  test("does not allow shared trays completed in the current experiment to be added to comparison", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = [
      ...snapshotState[STORAGE_KEYS.experiments],
      {
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-B",
        experiment_name: "高低温湿热试验",
        status: "已排程",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      ...snapshotState[STORAGE_KEYS.experiment_trays],
      { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-B", tray_code: "TP-001" },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        history: [
          {
            action: "实验完成",
            detail: "SYLU-2026-04-101 / 盐雾试验-A / 实验已完成",
            status: "实验已完成",
            time: "2026-04-02T10:30:00.000Z",
          },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "实验已完成",
        flow_status: "实验已完成",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验已完成", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-101-SP-002",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-002" }],
      },
    ];

    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("托盘已完成实验");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("TP-001 已完成实验，无需再次比对。");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').attributes("data-tone")).toBe("error");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-002");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");
    expect(mounted.get('[data-testid="laboratory-compare-complete"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "实验已完成",
      status: "实验已完成",
      trays: [expect.objectContaining({ status: "实验已完成", tray_code: "TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-002" })],
    }));
  });

  test("auto focuses the compare scan input when the compare modal opens", async () => {
    dispatchDefaultComparisonTrays();
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await nextTick();

    expect(document.activeElement).toBe(mounted.get('[data-testid="laboratory-compare-scan-input"]').element);
  });

  test("compare feedback lists all allowed laboratories when another tray belongs to multiple experiments", async () => {
    dispatchDefaultComparisonTrays();
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-301");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("当前任务并非优先所选任务");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("高低温湿热一室");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("盐雾试验室");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').attributes("data-tone")).toBe("error");
  });

  test("opens double confirmation modals for withdrawal and warns before withdrawing the current experiment trays", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-101",
        trays: [
          { quantity: 1, status: "已到达实验室", tray_code: "TP-001" },
          { quantity: 1, status: "已到达实验室", tray_code: "TP-002" },
        ],
      },
    ];
    const mounted = await mountPage();

    await clickResetTask();
    expect(mounted.find('[data-testid="laboratory-reset-confirm-modal"].is-open').exists()).toBe(true);
    expect(mounted.text()).toContain("是否撤回当前任务下当前实验对应托盘？");
    expect(mounted.get('[data-testid="laboratory-reset-confirm-modal"] .form-actions').classes()).toContain("form-actions--touch");

    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-reset-danger-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-reset-danger-modal"]').text()).toContain("危险操作确认");
    expect(mounted.get('[data-testid="laboratory-reset-danger-modal"]').text()).toContain("撤回后仅影响当前实验对应托盘");
    expect(mounted.get('[data-testid="laboratory-reset-danger-modal"] .form-actions').classes()).toContain("form-actions--touch");
  });

  test("submits only one withdrawal while the confirmation request is pending", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [{
      code: "SYLU-2026-04-101-SP-001",
      location: "盐雾试验室",
      owner: "王工",
      status: "已到达实验室",
      flow_status: "已到达实验室",
      task_code: "SYLU-2026-04-101",
      trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-001" }],
    }];
    const originalFetch = fetch.getMockImplementation();
    let resolveWithdrawal;
    fetch.mockImplementation((url, options) => {
      if (String(url).includes("/withdraw-current")) {
        return new Promise((resolve) => {
          resolveWithdrawal = resolve;
        });
      }
      return originalFetch(url, options);
    });
    const mounted = await mountPage();

    await clickResetTask();
    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();
    const confirmButton = mounted.get('[data-testid="laboratory-reset-danger-confirm"]');
    const firstSubmission = confirmButton.trigger("click");
    await nextTick();

    expect(confirmButton.attributes("disabled")).toBeDefined();
    expect(confirmButton.text()).toContain("撤回中");
    await confirmButton.trigger("click");
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/withdraw-current"))).toHaveLength(1);

    resolveWithdrawal({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, samples: snapshotState[STORAGE_KEYS.samples] }),
    });
    await firstSubmission;
    await flushPageUpdates();
  });

  test("disables the reset button while the current experiment is running", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];

    await mountPage();

    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(true);
  });

  test("disables the reset button after the current experiment is completed", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验已完成",
        flow_status: "实验已完成",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验已完成", tray_code: "TP-001" }],
      },
    ];

    await mountPage();

    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(true);
  });

  test("disables reset when the current experiment is partially complete and the next axis schedule has not been compared", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = [
      {
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        experiment_name: "振动试验",
        axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
      },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-vibration-axis-remaining",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:30:00.000Z",
        end_at: "2026-04-02T11:00:00.000Z",
        axis_codes: ["y-", "z+", "z-"],
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "振动试验部分完成 3/6轴",
        flow_status: "振动试验部分完成 3/6轴",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "振动试验部分完成 3/6轴", tray_code: "TP-001" }],
      },
    ];

    await mountPage();

    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(true);
    await clickResetTask();
    expect(wrapper.find('[data-testid="laboratory-reset-confirm-modal"].is-open').exists()).toBe(false);
    expect(fetch.mock.calls.some(([input]) => String(input).includes("/withdraw-current"))).toBe(false);
  });

  test("withdraws only the current salt-spray experiment trays after double confirmation", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      { code: "SYLU-2026-04-301", name: "复合环境任务", test_type: "高低温湿热试验 / 盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", experiment_name: "高低温湿热试验" },
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", experiment_name: "盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", tray_code: "TP-301-A" },
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", tray_code: "TP-301-B" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-salt",
        task_code: "SYLU-2026-04-301",
        experiment_code: "SYLU-2026-04-301-B",
        sub_experiment_code: "SYLU-2026-04-301-B-AXIS-002",
        axis_batch_no: "002",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:30:00.000Z",
        end_at: "2026-04-02T11:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-301-SP-001",
        location: "高低温湿热一室",
        owner: "赵工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-301",
        trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-301-A" }],
      },
      {
        code: "SYLU-2026-04-301-SP-002",
        location: "盐雾试验室",
        owner: "赵工",
        status: "实验准备就绪",
        flow_status: "实验准备就绪",
        task_code: "SYLU-2026-04-301",
        trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-301-B" }],
      },
    ];

    const mounted = await mountPage();

    await clickResetTask();
    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();
    await mounted.get('[data-testid="laboratory-reset-danger-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);

    expect(snapshotState[STORAGE_KEYS.samples]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SYLU-2026-04-301-SP-001",
          status: "已到达实验室",
          trays: [expect.objectContaining({ tray_code: "TP-301-A", status: "已到达实验室" })],
        }),
        expect.objectContaining({
          code: "SYLU-2026-04-301-SP-002",
          location: "接驳区",
          status: "到货",
          flow_status: "到货",
          trays: [expect.objectContaining({ tray_code: "TP-301-B", status: "到货" })],
        }),
      ]),
    );
    const withdrawCall = fetch.mock.calls.find(([input]) => String(input).includes("/api/laboratory/tasks/SYLU-2026-04-301/experiments/SYLU-2026-04-301-B/withdraw-current"));
    expect(withdrawCall).toBeDefined();
    expect(JSON.parse(withdrawCall[1]?.body || "{}")).toMatchObject({
      axisBatchNo: "002",
      scheduleId: "schedule-salt",
      subExperimentCode: "SYLU-2026-04-301-B-AXIS-002",
      trayCodes: ["TP-301-B"],
    });
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    expect(dispatchEventSpy.mock.calls.filter(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toHaveLength(1);
  });

  test("withdraws the reset snapshot when another task selection is attempted before confirmation", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = [
      {
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        experiment_name: "振动试验",
        axis_codes: ["x+", "x-", "y+", "y-", "z+", "z-"],
      },
      { task_code: "SYLU-2026-04-201", experiment_code: "SYLU-2026-04-201-A", experiment_name: "盐雾试验-B" },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-201-SP-001",
        location: "盐雾试验室",
        owner: "李工",
        status: "到货",
        flow_status: "到货",
        task_code: "SYLU-2026-04-201",
        trays: [{ quantity: 1, status: "到货", tray_code: "TP-101" }],
      },
    ];

    const mounted = await mountPage();

    await clickResetTask();
    expect(mounted.find('[data-testid="laboratory-reset-confirm-modal"].is-open').exists()).toBe(true);

    await mounted.get('[data-testid="laboratory-view-tasks"]').trigger("click");
    await mounted.get('[data-testid="laboratory-select-task-SYLU-2026-04-201"]').trigger("click");
    await mounted.get('[data-testid="laboratory-confirm-current-task"]').trigger("click");
    await nextTick();
    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(false);

    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();
    expect(mounted.find('[data-testid="laboratory-reset-danger-modal"].is-open').exists()).toBe(true);

    await mounted.get('[data-testid="laboratory-reset-danger-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);

    const withdrawCall = fetch.mock.calls.find(([input]) => String(input).includes("/api/laboratory/tasks/SYLU-2026-04-101/experiments/SYLU-2026-04-101-A/withdraw-current"));
    expect(withdrawCall).toBeDefined();
    expect(JSON.parse(withdrawCall[1]?.body || "{}").trayCodes).toEqual(["TP-001"]);
  });

  test("keeps the withdrawn tray state from the reset response when storage reload is stale", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-001" }],
      },
    ];
    const mounted = await mountPage();
    const staleSnapshot = JSON.parse(JSON.stringify(snapshotState));
    storageGetSnapshotOverride = () => staleSnapshot;

    await clickResetTask();
    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();
    await mounted.get('[data-testid="laboratory-reset-danger-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);

    expect(mounted.find('[data-testid="laboratory-reset-danger-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toContain("到货");
  });

  test("opens compare for a next-lab task after the shared tray completed a previous experiment", async () => {
    reactiveRoute.query = { lab: "高低温湿热一室" };
    masterLabsState = [
      { code: "LAB_HOT", name: "高低温湿热一室", type: "实验室", testTypeName: "高低温湿热试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      { code: "SYLU-2026-04-302", name: "复合环境任务", test_type: "盐雾试验 / 高低温湿热试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      {
        task_code: "SYLU-2026-04-302",
        experiment_code: "SYLU-2026-04-302-A",
        experiment_name: "盐雾试验",
        status: "实验已完成",
      },
      {
        task_code: "SYLU-2026-04-302",
        experiment_code: "SYLU-2026-04-302-B",
        experiment_name: "高低温湿热试验",
        status: "已排程",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-302", experiment_code: "SYLU-2026-04-302-A", tray_code: "TP-302" },
      { task_code: "SYLU-2026-04-302", experiment_code: "SYLU-2026-04-302-B", tray_code: "TP-302" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-302-b",
        task_code: "SYLU-2026-04-302",
        experiment_code: "SYLU-2026-04-302-B",
        device: "高低温湿热一室",
        start_at: "2026-04-02T09:30:00.000Z",
        end_at: "2026-04-02T11:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-302-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验已完成",
        flow_status: "实验已完成",
        task_code: "SYLU-2026-04-302",
        trays: [{ quantity: 1, status: "实验已完成", tray_code: "TP-302" }],
      },
    ];

    const mounted = await mountPage();

    expect(mounted.text()).not.toContain("高低温湿热一室操作台");
    expect(mounted.text()).toContain("SYLU-2026-04-302");
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-302");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");

    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      location: "高低温湿热一室",
      status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "TP-302" })],
    }));
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();
  });

  test("enables reset after a next-lab comparison while another shared tray only records the completed previous experiment", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    reactiveRoute.query = { lab: "温度冲击一室" };
    masterLabsState = [
      { code: "LAB_TEMP_SHOCK", name: "温度冲击一室", type: "实验室", testTypeName: "温度冲击试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      { code: "SYLU-2026-05-001", name: "综合台试验", test_type: "盐雾试验 / 温度冲击试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      {
        task_code: "SYLU-2026-05-001",
        experiment_code: "SYLU-2026-05-001-A",
        experiment_name: "盐雾试验",
        status: "实验已完成",
      },
      {
        task_code: "SYLU-2026-05-001",
        experiment_code: "SYLU-2026-05-001-B",
        experiment_name: "温度冲击试验",
        status: "已排程",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-A", tray_code: "SYLU-2026-05-001-TP-001" },
      { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-B", tray_code: "SYLU-2026-05-001-TP-001" },
      { task_code: "SYLU-2026-05-001", experiment_code: "SYLU-2026-05-001-B", tray_code: "SYLU-2026-05-001-TP-002" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-temp-shock",
        task_code: "SYLU-2026-05-001",
        experiment_code: "SYLU-2026-05-001-B",
        device: "温度冲击一室",
        start_at: "2026-05-21T08:00:00.000Z",
        end_at: "2026-05-21T11:30:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-05-001-SP-001",
        history: [
          { detail: "SYLU-2026-05-001 / 盐雾试验 / 实验已完成", status: "实验已完成", time: "2026-05-20T22:19:29.000Z" },
        ],
        location: "盐雾试验室",
        owner: "王工",
        status: "实验已完成",
        flow_status: "实验已完成",
        task_code: "SYLU-2026-05-001",
        trays: [{ quantity: 1, status: "实验已完成", tray_code: "SYLU-2026-05-001-TP-001" }],
      },
      {
        code: "SYLU-2026-05-001-SP-002",
        history: [
          { action: "盐雾实验完成", detail: "SYLU-2026-05-001 / 盐雾试验 / 实验已完成", status: "实验已完成", time: "2026-05-20T22:19:29.000Z" },
          { action: "送至实验室", location: "温度冲击一室", status: "送至实验室", time: "2026-05-20T22:18:48.000Z" },
        ],
        location: "温度冲击一室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-05-001",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "SYLU-2026-05-001-TP-002" }],
      },
    ];

    const mounted = await mountPage();

    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(true);

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("SYLU-2026-05-001-TP-002");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-compare-feedback"]').text()).toContain("比对正确");

    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      location: "温度冲击一室",
      status: "已到达实验室",
      flow_status: "已到达实验室",
      trays: [expect.objectContaining({ status: "已到达实验室", tray_code: "SYLU-2026-05-001-TP-002" })],
    }));
    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(false);

    await clickResetTask();
    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await nextTick();
    await mounted.get('[data-testid="laboratory-reset-danger-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 2);

    expect(mounted.find('[data-testid="laboratory-reset-danger-modal"].is-open').exists()).toBe(false);
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      status: "实验已完成",
      flow_status: "实验已完成",
      trays: [expect.objectContaining({ status: "实验已完成", tray_code: "SYLU-2026-05-001-TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      location: "接驳区",
      status: "到货",
      flow_status: "到货",
      trays: [expect.objectContaining({ status: "到货", tray_code: "SYLU-2026-05-001-TP-002" })],
    }));
  });

  test("persists compare, install, and ready steps into sample tray statuses and keeps progress after remount", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ fixtureReady: true, fixture_ready: true, quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-101-SP-002",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-002" }],
      },
    ];
    let mounted = await mountPage();
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "已到达实验室",
      status: "已到达实验室",
      trays: expect.arrayContaining([expect.objectContaining({ status: "已到达实验室", tray_code: "TP-001" })]),
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: expect.arrayContaining([expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" })]),
    }));
    expect(mounted.find(".laboratory-flow-note").exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();
    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(false);

    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-install-modal"]').classes()).toContain("laboratory-confirmation-modal");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 2);

    const fixtureInstallCall = await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    expect(fixtureInstallCall).toBeDefined();
    expect(JSON.parse(String(fixtureInstallCall[1].body))).toEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-101-A",
      fixture_install_id: expect.stringMatching(/^fixture-install-/),
      lab_code: "LAB_SALT",
      sample_count: 1,
      sample_type: "",
      task_code: "SYLU-2026-04-101",
      tray_codes: ["TP-001"],
    }));
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "工装夹具安装",
      status: "工装夹具安装",
      trays: expect.arrayContaining([expect.objectContaining({ status: "工装夹具安装", tray_code: "TP-001" })]),
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: expect.arrayContaining([expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" })]),
    }));
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-install"]').text()).toContain("重新下发");
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await nextTick();
    expect(mounted.find('[data-testid="laboratory-install-modal"].is-open').exists()).toBe(true);
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await flushPageUpdates();
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-countdown"]').text()).toBe("10");
    vi.advanceTimersByTime(3000);
    await flushPageUpdates();
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(true);
    expect(mounted.find('[data-testid="laboratory-fixture-success-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    expect(snapshotState[STORAGE_KEYS.samples][0].trays[0]).not.toEqual(expect.objectContaining({ fixture_ready: true }));

    snapshotState[STORAGE_KEYS.samples] = snapshotState[STORAGE_KEYS.samples].map((sample) =>
      sample.task_code === "SYLU-2026-04-101"
        ? {
            ...sample,
            trays: sample.trays.map((tray) =>
              tray.tray_code === "TP-001" ? { ...tray, fixtureReady: true, fixture_ready: true } : tray,
            ),
          }
        : sample,
    );
    const expectedStorageGetCalls = storageGetCalls().length + 1;
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await waitForStorageGetCount(expectedStorageGetCalls, { advanceStorageDebounce: true });
    await flushPageUpdates();
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(false);
    expect(mounted.find('[data-testid="laboratory-fixture-success-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-fixture-success-modal"]').text()).toContain("上位机已确认夹具安装完成");
    vi.advanceTimersByTime(1000);
    await flushPageUpdates();
    expect(mounted.find('[data-testid="laboratory-fixture-success-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    expect(mounted.get('[data-testid="laboratory-ready-modal"]').classes()).toContain("laboratory-confirmation-modal");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 4);

    const readyCall = await waitForLaboratoryMqCall("/api/mq/laboratory/ready");
    expect(readyCall).toBeDefined();
    expect(JSON.parse(String(readyCall[1].body))).toEqual({
      experiment_code: "SYLU-2026-04-101-A",
      lab_code: "LAB_SALT",
      schedule_id: "schedule-1",
      task_code: "SYLU-2026-04-101",
    });
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "实验准备就绪",
      status: "实验准备就绪",
      trays: expect.arrayContaining([expect.objectContaining({ status: "实验准备就绪", tray_code: "TP-001" })]),
    }));
    expect(snapshotState[STORAGE_KEYS.samples][1]).toEqual(expect.objectContaining({
      flow_status: "送至实验室",
      status: "送至实验室",
      trays: expect.arrayContaining([expect.objectContaining({ status: "送至实验室", tray_code: "TP-002" })]),
    }));
    expect(mounted.text()).toContain("当前任务已确认实验准备就绪");
    expect(dispatchEventSpy.mock.calls.filter(([event]) => event?.type === SAMPLES_UPDATED_EVENT)).toHaveLength(4);
    expect(laboratoryOperationCalls().map(([input]) => String(input))).toEqual([
      "/api/laboratory/operations",
      "/api/laboratory/operations",
      "/api/laboratory/operations",
    ]);
    expect(storagePutCalls()).toHaveLength(0);

    mounted.unmount();
    wrapper = undefined;

    mounted = await mountPage();
  });

  test("mqtt mode can resend fixture install when upper computer missed the first command", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    await flushPageUpdates();

    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "工装夹具安装",
      status: "工装夹具安装",
      trays: expect.arrayContaining([expect.objectContaining({ status: "工装夹具安装", tray_code: "TP-001" })]),
    }));
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-countdown"]').text()).toBe("10");
    vi.advanceTimersByTime(10_000);
    await flushPageUpdates();
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-install"]').text()).toContain("重新下发");

    const firstFixtureInstallCalls = fetch.mock.calls.filter(([input]) => String(input).includes("/api/mq/laboratory/fixture-install")).length;
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await flushPageUpdates();

    expect(fetch.mock.calls.filter(([input]) => String(input).includes("/api/mq/laboratory/fixture-install"))).toHaveLength(firstFixtureInstallCalls + 1);
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "工装夹具安装",
      status: "工装夹具安装",
      trays: expect.arrayContaining([expect.objectContaining({ status: "工装夹具安装", tray_code: "TP-001" })]),
    }));

    snapshotState[STORAGE_KEYS.samples] = snapshotState[STORAGE_KEYS.samples].map((sample) =>
      sample.task_code === "SYLU-2026-04-101"
        ? {
            ...sample,
            trays: sample.trays.map((tray) =>
              tray.tray_code === "TP-001" ? { ...tray, fixtureReady: true, fixture_ready: true } : tray,
            ),
          }
        : sample,
    );
    const expectedStorageGetCalls = storageGetCalls().length + 1;
    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await waitForStorageGetCount(expectedStorageGetCalls, { advanceStorageDebounce: true });
    await flushPageUpdates();

    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeUndefined();
  });

  test("mqtt fixture install wait times out after ten seconds and allows resend without refresh", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();

    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    await flushPageUpdates();

    expect(mounted.get('[data-testid="laboratory-fixture-confirm-modal"]').classes()).toContain("is-open");
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-countdown"]').text()).toBe("10");

    vi.advanceTimersByTime(10_000);
    await flushPageUpdates();

    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-install"]').text()).toContain("重新下发");
  });

  test("queues the latest fixture-ready refresh behind an older in-flight refresh", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "工装夹具安装",
        flow_status: "工装夹具安装",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "工装夹具安装", tray_code: "TP-001" }],
      },
    ];
    const mounted = await mountPage();
    const staleSnapshot = structuredClone(snapshotState);
    const readySnapshot = structuredClone(snapshotState);
    readySnapshot[STORAGE_KEYS.samples][0].trays[0] = {
      ...readySnapshot[STORAGE_KEYS.samples][0].trays[0],
      fixtureReady: true,
      fixture_ready: true,
    };
    const pendingSnapshots = [];
    storageGetSnapshotOverride = () => new Promise((resolve) => pendingSnapshots.push(resolve));

    window.dispatchEvent(new CustomEvent(SAMPLES_UPDATED_EVENT));
    await waitForQueueLength(pendingSnapshots, 1);
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
      detail: { keys: [STORAGE_KEYS.samples], updatedAt: "2026-04-02 18:00:00" },
    }));
    vi.advanceTimersByTime(100);
    await flushPageUpdates();
    expect(pendingSnapshots).toHaveLength(1);

    pendingSnapshots[0](staleSnapshot);
    await waitForQueueLength(pendingSnapshots, 2);
    pendingSnapshots[1](readySnapshot);
    await flushPageUpdates(12);
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeUndefined();
  });

  test("reloads the authoritative fixture-ready state when the realtime event is missed", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "工装夹具安装",
        flow_status: "工装夹具安装",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "工装夹具安装", tray_code: "TP-001" }],
      },
    ];
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    await flushPageUpdates();
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-modal"]').classes()).toContain("is-open");

    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.samples]: snapshotState[STORAGE_KEYS.samples].map((sample) => ({
        ...sample,
        trays: sample.trays.map((tray) => ({ ...tray, fixtureReady: true, fixture_ready: true })),
      })),
    };
    const expectedStorageGetCalls = storageGetCalls().length + 1;
    vi.advanceTimersByTime(10_000);
    await waitForStorageGetCount(expectedStorageGetCalls);
    await flushPageUpdates(20);

    expect(mounted.find('[data-testid="laboratory-fixture-success-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeUndefined();
  });

  test("shows a retryable error when mqtt fixture install publish fails", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-001" }],
      },
    ];
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      const attendanceResponse = handleAttendanceFetch(url, options);
      if (attendanceResponse) {
        return attendanceResponse;
      }
      if (url.includes("/api/mq/laboratory/fixture-install")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: false, reason: "broker offline" }) };
      }
      if (url.includes("/api/mq/laboratory")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: true }) };
      }
      if (url.includes("/api/mq/interface-mode")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, mode: HOST_INTERFACE_MODES.mqtt, subscriber_running: true }) };
      }
      if (url.includes("/api/master/labs")) {
        return { ok: true, status: 200, json: async () => masterLabsState };
      }
      if (url.includes("/api/storage")) {
        if ((options.method || "GET") === "PUT") {
          const body = JSON.parse(String(options.body || "{}"));
          snapshotState = { ...snapshotState, ...body };
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => snapshotState };
      }
      const operationResponse = handleLaboratoryOperationFetch(url, options);
      if (operationResponse) {
        return operationResponse;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    await flushPageUpdates();

    expect(mounted.get('[data-testid="laboratory-mq-error"]').text()).toContain("夹具安装下发失败");
    expect(mounted.get('[data-testid="laboratory-mq-error"]').text()).toContain("broker offline");
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeUndefined();
    expect(mounted.get('[data-testid="laboratory-install"]').text()).toContain("重新下发");
  });

  test("shows a retryable error when mqtt ready publish fails", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "工装夹具安装",
        flow_status: "工装夹具安装",
        task_code: "SYLU-2026-04-101",
        trays: [{ fixtureReady: true, fixture_ready: true, quantity: 1, status: "工装夹具安装", tray_code: "TP-001" }],
      },
    ];
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      const attendanceResponse = handleAttendanceFetch(url, options);
      if (attendanceResponse) {
        return attendanceResponse;
      }
      if (url.includes("/api/mq/laboratory/ready")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: false, reason: "broker offline" }) };
      }
      if (url.includes("/api/mq/laboratory")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: true }) };
      }
      if (url.includes("/api/mq/interface-mode")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, mode: HOST_INTERFACE_MODES.mqtt, subscriber_running: true }) };
      }
      if (url.includes("/api/master/labs")) {
        return { ok: true, status: 200, json: async () => masterLabsState };
      }
      if (url.includes("/api/storage")) {
        if ((options.method || "GET") === "PUT") {
          const body = JSON.parse(String(options.body || "{}"));
          snapshotState = { ...snapshotState, ...body };
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => snapshotState };
      }
      const operationResponse = handleLaboratoryOperationFetch(url, options);
      if (operationResponse) {
        return operationResponse;
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await waitForLaboratoryMqCall("/api/mq/laboratory/ready");
    await flushPageUpdates();

    expect(mounted.get('[data-testid="laboratory-mq-error"]').text()).toContain("准备就绪下发失败");
    expect(mounted.get('[data-testid="laboratory-mq-error"]').text()).toContain("broker offline");
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeUndefined();
  });

  test("refreshes into running state when MQTT experiment start arrives while ready success modal is open", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "工装夹具安装",
        flow_status: "工装夹具安装",
        task_code: "SYLU-2026-04-101",
        trays: [{ fixtureReady: true, fixture_ready: true, quantity: 1, status: "工装夹具安装", tray_code: "TP-001" }],
      },
    ];

    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await waitForLaboratoryMqCall("/api/mq/laboratory/ready");
    await flushPageUpdates();

    expect(mounted.find('[data-testid="laboratory-confirmed-modal"].is-open').exists()).toBe(true);
    expect(attendanceWorkStartCalls()).toHaveLength(0);

    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.samples]: snapshotState[STORAGE_KEYS.samples].map((sample) => ({
        ...sample,
        flow_status: "实验进行中",
        status: "实验进行中",
        trays: sample.trays.map((tray) => ({ ...tray, status: "实验进行中" })),
      })),
      [STORAGE_KEYS.experiments]: snapshotState[STORAGE_KEYS.experiments].map((experiment) =>
        experiment.experiment_code === "SYLU-2026-04-101-A" ? { ...experiment, status: "实验进行中" } : experiment,
      ),
      [STORAGE_KEYS.schedules]: snapshotState[STORAGE_KEYS.schedules].map((schedule) =>
        schedule.experiment_code === "SYLU-2026-04-101-A" ? { ...schedule, status: "实验进行中" } : schedule,
      ),
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "run-mqtt-start",
          run_no: "run-mqtt-start",
          schedule_id: "schedule-1",
          task_code: "SYLU-2026-04-101",
          experiment_code: "SYLU-2026-04-101-A",
          device: "盐雾试验室",
          tray_codes: ["TP-001"],
          status: "实验进行中",
          started_at: "2026-04-02T10:00:00.000Z",
          planned_end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
    };
    const expectedStorageGetCalls = storageGetCalls().length + 1;
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
      detail: {
        keys: [
          STORAGE_KEYS.samples,
          STORAGE_KEYS.experiments,
          STORAGE_KEYS.experiment_runs,
          STORAGE_KEYS.schedules,
        ],
      },
    }));

    await waitForStorageGetCount(expectedStorageGetCalls, { advanceStorageDebounce: true });
    await flushPageUpdates();

    expect(mounted.find('[data-testid="laboratory-confirmed-modal"].is-open').exists()).toBe(false);
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("实验进行中");
    expect(attendanceWorkStartCalls()).toHaveLength(1);
    expect(attendanceWorkStartCalls()[0][0]).toBe("/api/attendance/labs/%E7%9B%90%E9%9B%BE%E8%AF%95%E9%AA%8C%E5%AE%A4/work/start");
  });

  test("starts the fixture timeout only after install persistence and mqtt publish succeed", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-101-SP-002",
        location: "盐雾试验室",
        owner: "王工",
        status: "送至实验室",
        flow_status: "送至实验室",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-002" }],
      },
    ];
    let releaseLaboratoryOperation = () => {};
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      const attendanceResponse = handleAttendanceFetch(url, options);
      if (attendanceResponse) {
        return attendanceResponse;
      }
      if (url.includes("/api/laboratory/operations")) {
        return new Promise((resolve) => {
          releaseLaboratoryOperation = () => resolve(handleLaboratoryOperationFetch(url, options));
        });
      }
      if (url.includes("/api/storage")) {
        if ((options.method || "GET") === "PUT") {
          const payload = JSON.parse(String(options.body || "{}"));
          snapshotState = {
            ...snapshotState,
            ...payload,
          };
          return { ok: true, status: 200, json: async () => ({ ok: true }) };
        }
        return { ok: true, status: 200, json: async () => snapshotState };
      }
      if (url.includes("/api/mq/interface-mode")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, mode: HOST_INTERFACE_MODES.mqtt, subscriber_running: true }) };
      }
      if (url.includes("/api/mq/laboratory")) {
        return { ok: true, status: 200, json: async () => ({ ok: true, published: true }) };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });

    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await flushPageUpdates();

    expect(mounted.find('[data-testid="laboratory-install-modal"].is-open').exists()).toBe(false);
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-countdown"]').text()).toBe("10");
    expect(laboratoryMqCalls()).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    await flushPageUpdates();
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-countdown"]').text()).toBe("10");

    releaseLaboratoryOperation();
    await waitForLaboratoryMqCall("/api/mq/laboratory/fixture-install");
    await flushPageUpdates();
    expect(laboratoryMqCalls()).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    await flushPageUpdates();
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-countdown"]').text()).toBe("9");
  });

  test("uses local hostless MQTT fixture ready and start for hot humid laboratory two", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "高低温湿热二室" };
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-04-601", name: "高低温湿热二室任务", test_type: "高低温湿热试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        { task_code: "SYLU-2026-04-601", experiment_code: "SYLU-2026-04-601-A", experiment_name: "高低温湿热试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-04-601", experiment_code: "SYLU-2026-04-601-A", tray_code: "TP-GDW-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-hot-humid-2",
          task_code: "SYLU-2026-04-601",
          experiment_code: "SYLU-2026-04-601-A",
          device: "高低温湿热二室",
          start_at: "2026-04-02T10:00:00.000Z",
          end_at: "2026-04-02T12:00:00.000Z",
          sub_experiment_code: "hot-humid-segment-1",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-601-SP-001",
          location: "高低温湿热二室",
          owner: "赵工",
          status: "送至实验室",
          flow_status: "送至实验室",
          task_code: "SYLU-2026-04-601",
          trays: [{ quantity: 1, status: "送至实验室", tray_code: "TP-GDW-001" }],
        },
      ],
    };
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");

    const mounted = await mountPage();

    expect(mounted.text()).not.toContain("高低温湿热二室操作台");
    await mounted.get('[data-testid="laboratory-compare"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-scan-input"]').setValue("TP-GDW-001");
    await mounted.get('[data-testid="laboratory-compare-scan-submit"]').trigger("click");
    await mounted.get('[data-testid="laboratory-compare-complete"]').trigger("click");
    await flushPageUpdates();
    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 2);

    expect(laboratoryMqCalls()).toHaveLength(0);
    expect(mounted.find('[data-testid="laboratory-fixture-confirm-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-countdown"]').text()).toBe("3");
    expect(mounted.get('[data-testid="laboratory-fixture-confirm-modal"]').text()).toContain("本地自动确认");
    expect(laboratoryOperationCalls().map(([, options]) => JSON.parse(String(options.body || "{}")).operationType)).toEqual(["compare", "install"]);

    vi.advanceTimersByTime(2999);
    await flushPageUpdates();
    expect(laboratoryOperationCalls().map(([, options]) => JSON.parse(String(options.body || "{}")).operationType)).toEqual(["compare", "install"]);

    vi.advanceTimersByTime(1);
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 3);
    expect(laboratoryOperationCalls().map(([, options]) => JSON.parse(String(options.body || "{}")).operationType)).toEqual([
      "compare",
      "install",
      "fixtureReady",
    ]);
    expect(mounted.find('[data-testid="laboratory-fixture-success-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeUndefined();

    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 4);
    expect(laboratoryStartCalls()).toHaveLength(0);
    expect(attendanceWorkStartCalls()).toHaveLength(0);
    expect(mounted.get('[data-testid="laboratory-ready"]').text()).not.toContain("重新下发准备");
    expect(mounted.find('[data-testid="laboratory-confirmed-modal"].is-open').exists()).toBe(true);
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();

    vi.advanceTimersByTime(3000);
    await waitForLaboratoryStartCount(1);
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 5);
    await flushPageUpdates();

    expect(laboratoryStartCalls()[0][0]).toBe("/api/laboratory/tasks/SYLU-2026-04-601/experiments/SYLU-2026-04-601-A/start");
    expect(attendanceWorkStartCalls()).toHaveLength(0);
    expect(document.body.querySelector('[data-testid="laboratory-attendance-status"]')?.textContent || "").toContain("当前 00:00:03");
    expect(JSON.parse(String(laboratoryStartCalls()[0][1].body || "{}"))).toEqual(expect.objectContaining({
      labCode: "LAB_HOT_HUMID_2",
      labName: "高低温湿热二室",
      runNo: expect.stringMatching(/^run-\d+-\d{3}$/),
      scheduleId: "schedule-hot-humid-2",
      startedAt: `${toDisplayedDateTime("2026-04-02T10:00:06.000Z")}:06`,
      subExperimentCode: "hot-humid-segment-1",
      trayCodes: ["TP-GDW-001"],
    }));
    expect(laboratoryMqCalls()).toHaveLength(0);
    expect(snapshotState[STORAGE_KEYS.experiment_runs]).toContainEqual(expect.objectContaining({
      run_no: "run-hot-humid-2",
      status: "实验进行中",
    }));
    expect(snapshotState[STORAGE_KEYS.experiment_run_trays]).toContainEqual(expect.objectContaining({
      run_no: "run-hot-humid-2",
      tray_code: "TP-GDW-001",
    }));
    expect(mounted.find('[data-testid="laboratory-confirmed-modal"].is-open').exists()).toBe(false);
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("SYLU-2026-04-601");
  });

  test("clears pending hostless fixture-ready timers when the hot humid laboratory two task is reset", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "高低温湿热二室" };
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-04-602", name: "高低温湿热二室重置任务", test_type: "高低温湿热试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        { task_code: "SYLU-2026-04-602", experiment_code: "SYLU-2026-04-602-A", experiment_name: "高低温湿热试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-04-602", experiment_code: "SYLU-2026-04-602-A", tray_code: "TP-GDW-002" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-hot-humid-2-reset",
          task_code: "SYLU-2026-04-602",
          experiment_code: "SYLU-2026-04-602-A",
          device: "高低温湿热二室",
          start_at: "2026-04-02T10:00:00.000Z",
          end_at: "2026-04-02T12:00:00.000Z",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-602-SP-001",
          location: "高低温湿热二室",
          owner: "赵工",
          status: "已到达实验室",
          flow_status: "已到达实验室",
          task_code: "SYLU-2026-04-602",
          trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-GDW-002" }],
        },
      ],
    };
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    const mounted = await mountPage();

    await mounted.get('[data-testid="laboratory-install"]').trigger("click");
    await mounted.get('[data-testid="laboratory-install-confirm"]').trigger("click");
    await waitForSamplesUpdatedEvent(dispatchEventSpy, 1);
    expect(resetTaskButton()?.hasAttribute("disabled")).toBe(false);
    await clickResetTask();
    await mounted.get('[data-testid="laboratory-reset-confirm"]').trigger("click");
    await mounted.get('[data-testid="laboratory-reset-danger-confirm"]').trigger("click");
    await flushPageUpdates();

    vi.advanceTimersByTime(3000);
    await flushPageUpdates();

    expect(laboratoryOperationCalls().map(([, options]) => JSON.parse(String(options.body || "{}")).operationType)).toEqual(["install"]);
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "到货",
      status: "到货",
      trays: [expect.objectContaining({ status: "到货", tray_code: "TP-GDW-002" })],
    }));
  });

  test("renders only the full-width tray flow and allows switching trays within the current experiment", async () => {
    const mounted = await mountPage();

    expect(mounted.find('[data-testid="laboratory-task-flow"]').exists()).toBe(false);
    expect(mounted.get('[data-testid="laboratory-tray-flow"]').text()).not.toContain("托盘流程图");
    expect(mounted.get('[data-testid="laboratory-tray-flow"]').classes()).toContain("laboratory-flow-card--full");
    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toContain("TP-001");
    expect(mounted.get('[data-testid="laboratory-tray-flow-list"]').classes()).toContain("laboratory-flow-steps--tray");
    const firstTrayStep = mounted.get('[data-testid="laboratory-tray-flow-step-in_transit"]');
    expect(firstTrayStep.element.children[0].className).toBe("laboratory-flow-label");
    expect(firstTrayStep.element.children[1].className).toBe("laboratory-flow-time");
    expect(firstTrayStep.get(".laboratory-flow-time").attributes("title")).toBe(
      firstTrayStep.get(".laboratory-flow-time").text(),
    );
    expect(mounted.get('[data-testid="laboratory-tray-flow-step-in_transit"]').classes()).toContain("is-reached");
    expect(mounted.get('[data-testid="laboratory-tray-flow-step-arrived"]').classes()).toContain("is-active");

    await mounted.get('[data-testid="laboratory-tray-tab-TP-002"]').trigger("click");

    expect(mounted.get('[data-testid="laboratory-tray-flow-status"]').text()).toContain("TP-002");
    expect(mounted.get('[data-testid="laboratory-tray-tab-TP-002"]').classes()).toContain("is-active");
    expect(mounted.get('[data-testid="laboratory-tray-flow-step-in_transit"]').classes()).toContain("is-reached");
    expect(mounted.get('[data-testid="laboratory-tray-flow-step-arrived"]').classes()).toContain("is-active");
  });

  test("shows a floating running modal, allows temporary hide, and restores it from the overview button", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-101-SP-002",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-002" }],
      },
    ];
    addActiveExperimentRun({ trayCodes: ["TP-001", "TP-002"] });

    const mounted = await mountPage();
    const findRunningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');
    const findRunningBackdrop = () => document.body.querySelector('[data-testid="laboratory-running-backdrop"]');

    const showRunningButton = () => document.body.querySelector('[data-testid="laboratory-show-running-modal"]');

    expect(showRunningButton()?.getAttribute("disabled")).toBeNull();
    expect(document.body.querySelectorAll(".modal.is-open")).toHaveLength(0);
    expect(findRunningModal()?.textContent || "").toContain("SYLU-2026-04-101");
    expect(findRunningModal()?.textContent || "").toContain("TP-001");
    expect(findRunningModal()?.textContent || "").toContain("TP-002");
    expect(findRunningModal()?.textContent || "").toContain("SYLU-2026-04-101-SP-001");
    expect((document.body.querySelector('[data-testid="laboratory-running-countdown"]')?.textContent || "")).toContain("01:00:00");
    expect(document.body.querySelector('[data-testid="laboratory-open-schedule"]')?.getAttribute("disabled")).not.toBeNull();
    expect(mounted.get('[data-testid="laboratory-compare"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-install"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
    expect(mounted.get('[data-testid="laboratory-view-tasks"]').attributes("disabled")).toBeUndefined();

    findRunningBackdrop()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(findRunningModal()).toBeNull();
    expect(showRunningButton()?.getAttribute("disabled")).toBeNull();

    showRunningButton()?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(findRunningModal()).not.toBeNull();

    document.body.querySelector('[data-testid="laboratory-complete-experiment"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(document.body.querySelector('[data-testid="laboratory-complete-confirm-modal"]')).toBeNull();
    expect(findRunningModal()?.textContent || "").toContain("确认后将通知上位机立即结束当前盐雾试验-A");
    expect(findRunningModal()?.textContent || "").toContain("SYLU-2026-04-101");
    expect(findRunningModal()?.textContent || "").toContain("TP-001");
  });

  test("opens all trays and samples by clicking the running sample area without a separate view-all button", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiment_trays] = Array.from({ length: 7 }, (_, index) => ({
      task_code: "SYLU-2026-04-101",
      experiment_code: "SYLU-2026-04-101-A",
      tray_code: `TP-${String(index + 1).padStart(3, "0")}`,
    }));
    snapshotState[STORAGE_KEYS.samples] = Array.from({ length: 7 }, (_, index) => {
      const number = String(index + 1).padStart(3, "0");
      return {
        code: `SYLU-2026-04-101-SP-${number}`,
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: `TP-${number}` }],
      };
    });
    addActiveExperimentRun({
      trayCodes: Array.from({ length: 7 }, (_, index) => `TP-${String(index + 1).padStart(3, "0")}`),
    });

    const mounted = await mountPage();
    const runningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');

    expect(runningModal()?.querySelectorAll('[data-testid^="laboratory-running-tray-chip-"]')).toHaveLength(3);
    expect(runningModal()?.querySelectorAll('[data-testid^="laboratory-running-sample-chip-"]')).toHaveLength(5);
    expect(runningModal()?.textContent || "").toContain("+4");
    expect(runningModal()?.textContent || "").toContain("+2");
    expect(runningModal()?.textContent || "").not.toContain("TP-007");
    expect(runningModal()?.querySelector('[data-testid="laboratory-running-show-all"]')).toBeNull();
    expect(runningModal()?.textContent || "").not.toContain("查看全部");

    runningModal()?.querySelector('[data-testid="laboratory-running-samples-trigger"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(mounted.find('[data-testid="laboratory-full-content-modal"].is-open').exists()).toBe(true);
    expect(mounted.findAll("[data-testid^='laboratory-full-tray-row-']")).toHaveLength(7);
    expect(mounted.text()).toContain("TP-007");
    expect(mounted.text()).toContain("SYLU-2026-04-101-SP-007");

    mounted.get('[data-testid="laboratory-full-content-modal"] .modal-close').trigger("click");
    await nextTick();
    const completeExperimentButton = runningModal()?.querySelector('[data-testid="laboratory-complete-experiment"]');
    expect(completeExperimentButton?.classList.contains("laboratory-running-complete-button")).toBe(true);
    completeExperimentButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();

    expect(runningModal()?.textContent || "").toContain("托盘 7 个");
    expect(runningModal()?.textContent || "").toContain("样品 7 个");
    expect(runningModal()?.textContent || "").not.toContain("查看全部");
    expect(runningModal()?.textContent || "").not.toContain("TP-007、");
  });

  test("keeps the running experiment overdue instead of completing from the client countdown", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = snapshotState[STORAGE_KEYS.experiments].map((experiment) =>
      experiment.experiment_code === "SYLU-2026-04-101-A"
        ? { ...experiment, status: "实验进行中" }
        : experiment,
    );
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        start_at: "2026-04-02 17:59:58",
        end_at: "2026-04-02 18:00:01",
        status: "实验进行中",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_runs] = [
      {
        id: "run-1",
        run_no: "run-1",
        schedule_id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        tray_codes: ["TP-001"],
        status: "实验进行中",
        started_at: "2026-04-02 17:59:58",
        planned_end_at: "2026-04-02 18:00:01",
      },
    ];

    const mounted = await mountPage();

    expect(mounted.find('[data-testid="laboratory-complete-confirm-modal"].is-open').exists()).toBe(false);

    vi.advanceTimersByTime(2000);
    await flushPageUpdates();

    expect(document.body.querySelector('[data-testid="laboratory-complete-confirm-modal"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("实验已超时");
    expect(laboratoryEndRequestCalls()).toHaveLength(0);
    document.body.querySelector('[data-testid="laboratory-running-backdrop"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();
    expect(snapshotState[STORAGE_KEYS.samples][0]).toEqual(expect.objectContaining({
      flow_status: "实验进行中",
      status: "实验进行中",
      trays: [expect.objectContaining({ status: "实验进行中", tray_code: "TP-001" })],
    }));
    expect(snapshotState[STORAGE_KEYS.experiments]).toContainEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-101-A",
      status: "实验进行中",
    }));
    expect(snapshotState[STORAGE_KEYS.schedules]).toContainEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-101-A",
      status: "实验进行中",
    }));
    expect(snapshotState[STORAGE_KEYS.experiment_runs]).toContainEqual(expect.objectContaining({
      run_no: "run-1",
      status: "实验进行中",
    }));
  });

  test("automatically closes the completed experiment popup after sixty seconds", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = snapshotState[STORAGE_KEYS.experiments].map((experiment) =>
      experiment.experiment_code === "SYLU-2026-04-101-A"
        ? { ...experiment, status: "实验进行中" }
        : experiment,
    );
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:59:58.000Z",
        end_at: "2026-04-02T10:00:01.000Z",
        status: "实验进行中",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_runs] = [
      {
        id: "run-1",
        run_no: "run-1",
        schedule_id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        tray_codes: ["TP-001"],
        status: "实验进行中",
        started_at: "2026-04-02T09:59:58.000Z",
        planned_end_at: "2026-04-02T10:00:01.000Z",
      },
    ];

    await mountPage();

    vi.advanceTimersByTime(2000);
    await flushPageUpdates();
    expect(laboratoryEndRequestCalls()).toHaveLength(0);

    document.body.querySelector('[data-testid="laboratory-complete-experiment"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    document.body.querySelector('[data-testid="laboratory-complete-experiment-confirm"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForLaboratoryEndRequestCount(1);
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("实验已完成");

    vi.advanceTimersByTime(59_000);
    await flushPageUpdates();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).not.toBeNull();

    vi.advanceTimersByTime(1_000);
    await flushPageUpdates();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();
  });

  test("keeps the running modal open as completed when MQTT storage marks the run completed", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = snapshotState[STORAGE_KEYS.experiments].map((experiment) =>
      experiment.experiment_code === "SYLU-2026-04-101-A"
        ? { ...experiment, status: "实验进行中" }
        : experiment,
    );
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-101", experiment_code: "SYLU-2026-04-101-A", tray_code: "TP-001" },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:59:58.000Z",
        end_at: "2026-04-02T10:30:00.000Z",
        status: "实验进行中",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_runs] = [
      {
        id: "run-1",
        run_no: "run-1",
        schedule_id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        tray_codes: ["TP-001"],
        status: "实验进行中",
        started_at: "2026-04-02T09:59:58.000Z",
        planned_end_at: "2026-04-02T10:30:00.000Z",
      },
    ];
    await mountPage();

    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("实验进行中");

    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.samples]: snapshotState[STORAGE_KEYS.samples].map((sample) => ({
        ...sample,
        flow_status: "实验已完成",
        status: "实验已完成",
        trays: sample.trays.map((tray) => ({ ...tray, status: "实验已完成" })),
      })),
      [STORAGE_KEYS.experiment_runs]: snapshotState[STORAGE_KEYS.experiment_runs].map((run) => ({
        ...run,
        ended_at: "2026-04-02T10:05:00.000Z",
        status: "实验已完成",
      })),
    };
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
      detail: { keys: [STORAGE_KEYS.samples, STORAGE_KEYS.experiment_runs] },
    }));
    await waitForStorageGetCount(2, { advanceStorageDebounce: true });
    await flushPageUpdates();

    const modalText = document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "";
    expect(modalText).toContain("实验已完成");
    expect(modalText).not.toContain("实验已超时");
  });

  test("completing one experiment run keeps the schedule active when another tray still needs the same experiment", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.experiments] = snapshotState[STORAGE_KEYS.experiments].map((experiment) =>
      experiment.experiment_code === "SYLU-2026-04-101-A"
        ? { ...experiment, status: "实验进行中" }
        : experiment,
    );
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
      {
        code: "SYLU-2026-04-101-SP-002",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验准备就绪",
        flow_status: "实验准备就绪",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-002" }],
      },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:59:58.000Z",
        end_at: "2026-04-02T10:00:01.000Z",
        status: "实验进行中",
      },
    ];
    snapshotState[STORAGE_KEYS.experiment_runs] = [
      {
        id: "run-1",
        run_no: "run-1",
        schedule_id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        tray_codes: ["TP-001"],
        status: "实验进行中",
        started_at: "2026-04-02T09:59:58.000Z",
        planned_end_at: "2026-04-02T10:00:01.000Z",
      },
    ];
    await mountPage();

    vi.advanceTimersByTime(2000);
    await flushPageUpdates();
    expect(laboratoryEndRequestCalls()).toHaveLength(0);

    document.body.querySelector('[data-testid="laboratory-complete-experiment"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    document.body.querySelector('[data-testid="laboratory-complete-experiment-confirm"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForLaboratoryEndRequestCount(1);

    expect(snapshotState[STORAGE_KEYS.samples]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SYLU-2026-04-101-SP-001",
          status: "实验已完成",
          trays: [expect.objectContaining({ tray_code: "TP-001", status: "实验已完成" })],
        }),
        expect.objectContaining({
          code: "SYLU-2026-04-101-SP-002",
          status: "实验准备就绪",
          trays: [expect.objectContaining({ tray_code: "TP-002", status: "实验准备就绪" })],
        }),
      ]),
    );
    expect(snapshotState[STORAGE_KEYS.experiment_runs]).toContainEqual(expect.objectContaining({
      run_no: "run-1",
      status: "实验已完成",
    }));
    expect(snapshotState[STORAGE_KEYS.experiments]).toContainEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-101-A",
      status: "实验进行中",
    }));
    expect(snapshotState[STORAGE_KEYS.schedules]).toContainEqual(expect.objectContaining({
      experiment_code: "SYLU-2026-04-101-A",
      status: "实验进行中",
    }));
  });

  test("does not force the overview modal back open when the experiment becomes overdue while the modal is hidden", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-1",
        task_code: "SYLU-2026-04-101",
        experiment_code: "SYLU-2026-04-101-A",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:59:58.000Z",
        end_at: "2026-04-02T10:00:01.000Z",
      },
    ];
    await mountPage();

    document.body.querySelector('[data-testid="laboratory-running-backdrop"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();

    vi.advanceTimersByTime(2_000);
    await nextTick();
    await nextTick();

    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();
  });

  test("restores the running modal after 10 seconds of inactivity when it was hidden", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    addActiveExperimentRun();

    await mountPage();
    const findRunningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');

    document.body.querySelector('[data-testid="laboratory-running-backdrop"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(findRunningModal()).toBeNull();

    vi.advanceTimersByTime(10_000);
    await nextTick();
    await nextTick();

    expect(findRunningModal()).not.toBeNull();
  });

  test("shows the running countdown when an external process start pushes the selected impact lab snapshot update", async () => {
    const eventSources = [];
    class MockEventSource {
      constructor(url, options) {
        this.url = url;
        this.options = options;
        this.listeners = {};
        this.close = vi.fn();
        eventSources.push(this);
      }

      addEventListener(type, listener) {
        this.listeners[type] = listener;
      }
    }
    vi.stubGlobal("EventSource", MockEventSource);
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-04-501", name: "冲击连接器", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", experiment_name: "冲击试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", tray_code: "TP-CJ-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-04-501",
          experiment_code: "SYLU-2026-04-501-A",
          device: "冲击一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-501-SP-001",
          location: "冲击一室",
          owner: "周工",
          status: "实验准备就绪",
          flow_status: "实验准备就绪",
          task_code: "SYLU-2026-04-501",
          trays: [{ quantity: 1, status: "实验准备就绪", tray_code: "TP-CJ-001" }],
        },
      ],
    };

    await mountPage();

    expect(eventSources[0]).toEqual(expect.objectContaining({
      options: { withCredentials: true },
    }));
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();

    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.samples]: [
        {
          ...snapshotState[STORAGE_KEYS.samples][0],
          status: "实验进行中",
          flow_status: "实验进行中",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-CJ-001" }],
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "run-impact",
          run_no: "run-impact",
          schedule_id: "schedule-impact",
          task_code: "SYLU-2026-04-501",
          experiment_code: "SYLU-2026-04-501-A",
          device: "冲击一室",
          tray_codes: ["TP-CJ-001"],
          status: "实验进行中",
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
    };
    const expectedStorageGetCalls = storageGetCalls().length + 1;
    eventSources[0].listeners.message({
      data: JSON.stringify({ keys: [STORAGE_KEYS.samples, STORAGE_KEYS.experiment_runs], updatedAt: "2026-04-02T10:00:00.000Z" }),
    });
    await waitForStorageGetCount(expectedStorageGetCalls, { advanceStorageDebounce: true });
    await flushPageUpdates();

    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("SYLU-2026-04-501");
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("TP-CJ-001");
    expect(document.body.querySelector('[data-testid="laboratory-running-countdown"]')?.textContent || "").toContain("01:00:00");
  });

  test("refreshes into running while the MQTT ready confirmation modal is still open for the selected lab", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "冲击一室" };
    masterLabsState = [
      { code: "LAB_IMPACT_1", name: "冲击一室", type: "实验室", testTypeName: "冲击试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-04-501", name: "冲击连接器", test_type: "冲击试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", experiment_name: "冲击试验" },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-04-501", experiment_code: "SYLU-2026-04-501-A", tray_code: "TP-CJ-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-impact",
          task_code: "SYLU-2026-04-501",
          experiment_code: "SYLU-2026-04-501-A",
          device: "冲击一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-04-501-SP-001",
          location: "冲击一室",
          owner: "周工",
          status: "工装夹具安装",
          flow_status: "工装夹具安装",
          task_code: "SYLU-2026-04-501",
          trays: [{ fixtureReady: true, fixture_ready: true, quantity: 1, status: "工装夹具安装", tray_code: "TP-CJ-001" }],
        },
      ],
    };

    const mounted = await mountPage();
    await mounted.get('[data-testid="laboratory-ready"]').trigger("click");
    await mounted.get('[data-testid="laboratory-ready-confirm"]').trigger("click");
    await waitForLaboratoryMqCall("/api/mq/laboratory/ready");
    await flushPageUpdates();

    expect(mounted.find('[data-testid="laboratory-confirmed-modal"].is-open').exists()).toBe(true);
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')).toBeNull();

    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.samples]: [
        {
          ...snapshotState[STORAGE_KEYS.samples][0],
          status: "实验进行中",
          flow_status: "实验进行中",
          trays: [{ fixtureReady: true, fixture_ready: true, quantity: 1, status: "实验进行中", tray_code: "TP-CJ-001" }],
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "run-impact",
          run_no: "run-impact",
          schedule_id: "schedule-impact",
          task_code: "SYLU-2026-04-501",
          experiment_code: "SYLU-2026-04-501-A",
          device: "冲击一室",
          tray_codes: ["TP-CJ-001"],
          status: "实验进行中",
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T11:00:00.000Z",
        },
      ],
    };
    const expectedStorageGetCalls = storageGetCalls().length + 1;
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
      detail: { keys: [STORAGE_KEYS.samples, STORAGE_KEYS.experiment_runs], updatedAt: "2026-04-02T10:00:00.000Z" },
    }));
    await waitForStorageGetCount(expectedStorageGetCalls, { advanceStorageDebounce: true });
    await flushPageUpdates();

    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("SYLU-2026-04-501");
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("TP-CJ-001");
    expect(document.body.querySelector('[data-testid="laboratory-running-countdown"]')?.textContent || "").toContain("01:00:00");
    expect(mounted.get('[data-testid="laboratory-ready"]').attributes("disabled")).toBeDefined();
  });

  test("does not restore the running modal while pointer activity continues during the 10-second idle window", async () => {
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-101-SP-001",
        location: "盐雾试验室",
        owner: "王工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-101",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-001" }],
      },
    ];
    addActiveExperimentRun();

    await mountPage();
    const findRunningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');

    document.body.querySelector('[data-testid="laboratory-running-backdrop"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    expect(findRunningModal()).toBeNull();

    vi.advanceTimersByTime(9_000);
    window.dispatchEvent(new MouseEvent("mousemove", { bubbles: true }));
    await nextTick();

    vi.advanceTimersByTime(1_500);
    await nextTick();
    await nextTick();

    expect(findRunningModal()).toBeNull();

    vi.advanceTimersByTime(10_000);
    await nextTick();
    await nextTick();

    expect(findRunningModal()).not.toBeNull();
  });

  test("completes only the current salt spray experiment trays and keeps the completed modal after confirmation", async () => {
    const dispatchEventSpy = vi.spyOn(window, "dispatchEvent");
    snapshotState = createSnapshot();
    snapshotState[STORAGE_KEYS.tasks] = [
      { code: "SYLU-2026-04-301", name: "复合环境任务", test_type: "高低温湿热试验 / 盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiments] = [
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", experiment_name: "高低温湿热试验" },
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", experiment_name: "盐雾试验" },
    ];
    snapshotState[STORAGE_KEYS.experiment_trays] = [
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-A", tray_code: "TP-301-A" },
      { task_code: "SYLU-2026-04-301", experiment_code: "SYLU-2026-04-301-B", tray_code: "TP-301-B" },
    ];
    snapshotState[STORAGE_KEYS.schedules] = [
      {
        id: "schedule-salt",
        task_code: "SYLU-2026-04-301",
        experiment_code: "SYLU-2026-04-301-B",
        device: "盐雾试验室",
        start_at: "2026-04-02T09:30:00.000Z",
        end_at: "2026-04-02T11:00:00.000Z",
      },
    ];
    snapshotState[STORAGE_KEYS.samples] = [
      {
        code: "SYLU-2026-04-301-SP-001",
        location: "高低温湿热一室",
        owner: "赵工",
        status: "已到达实验室",
        flow_status: "已到达实验室",
        task_code: "SYLU-2026-04-301",
        trays: [{ quantity: 1, status: "已到达实验室", tray_code: "TP-301-A" }],
      },
      {
        code: "SYLU-2026-04-301-SP-002",
        location: "盐雾试验室",
        owner: "赵工",
        status: "实验进行中",
        flow_status: "实验进行中",
        task_code: "SYLU-2026-04-301",
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-301-B" }],
      },
    ];
    addActiveExperimentRun({
      experimentCode: "SYLU-2026-04-301-B",
      runNo: "run-salt-301",
      scheduleId: "schedule-salt",
      taskCode: "SYLU-2026-04-301",
      trayCodes: ["TP-301-B"],
    });

    await mountPage();
    const findRunningModal = () => document.body.querySelector('[data-testid="laboratory-running-modal"]');

    document.body.querySelector('[data-testid="laboratory-complete-experiment"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    document.body.querySelector('[data-testid="laboratory-complete-experiment-confirm"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await nextTick();
    await nextTick();
    await waitForLaboratoryEndRequestCount(1);

    expect(snapshotState[STORAGE_KEYS.samples]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "SYLU-2026-04-301-SP-001",
          status: "已到达实验室",
          trays: [expect.objectContaining({ tray_code: "TP-301-A", status: "已到达实验室" })],
        }),
        expect.objectContaining({
          code: "SYLU-2026-04-301-SP-002",
          status: "实验已完成",
          flow_status: "实验已完成",
          trays: [expect.objectContaining({ tray_code: "TP-301-B", status: "实验已完成" })],
        }),
      ]),
    );
    expect(findRunningModal()?.textContent || "").toContain("实验已完成");
    expect(findRunningModal()?.textContent || "").toContain("TP-301-B");
    expect(findRunningModal()?.textContent || "").not.toContain("TP-301-A");
    expect(dispatchEventSpy.mock.calls.filter(([event]) => event?.type === SNAPSHOT_UPDATED_EVENT)).toHaveLength(1);
  });

  test("keeps axis continuation disabled across adjacent single-axis schedules", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
      { code: "LAB_SALT", name: "盐雾试验室", type: "实验室", testTypeName: "盐雾试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-201", name: "振动轴向任务", test_type: "振动试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-06-201",
          experiment_code: "SYLU-2026-06-201-A",
          experiment_name: "振动试验",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-201", experiment_code: "SYLU-2026-06-201-A", tray_code: "TP-VIB-001" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-vib-y-plus",
          task_code: "SYLU-2026-06-201",
          experiment_code: "SYLU-2026-06-201-A",
          device: "振动一室",
          axis_codes: ["y+"],
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T10:00:00.000Z",
          status: "实验进行中",
        },
        {
          id: "schedule-vib-x-minus",
          task_code: "SYLU-2026-06-201",
          experiment_code: "SYLU-2026-06-201-A",
          device: "振动一室",
          axis_codes: ["x-"],
          start_at: "2026-04-02T10:00:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
          status: "已排程",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-201-SP-001",
          location: "振动一室",
          owner: "周工",
          status: "实验进行中",
          flow_status: "实验进行中",
          task_code: "SYLU-2026-06-201",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-VIB-001" }],
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "RUN-VIB-AXIS",
          run_no: "RUN-VIB-AXIS",
          schedule_id: "schedule-vib-y-plus",
          task_code: "SYLU-2026-06-201",
          experiment_code: "SYLU-2026-06-201-A",
          device: "振动一室",
          tray_codes: ["TP-VIB-001"],
          status: "实验进行中",
          axis_codes: ["z-", "y+", "x-"],
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T10:00:00.000Z",
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: [
        {
          run_no: "RUN-VIB-AXIS",
          task_code: "SYLU-2026-06-201",
          experiment_code: "SYLU-2026-06-201-A",
          axis_code: "z-",
          step_no: 1,
          status: "实验已完成",
        },
        {
          run_no: "RUN-VIB-AXIS",
          task_code: "SYLU-2026-06-201",
          experiment_code: "SYLU-2026-06-201-A",
          axis_code: "y+",
          step_no: 2,
          status: "实验进行中",
        },
        {
          run_no: "RUN-VIB-AXIS",
          task_code: "SYLU-2026-06-201",
          experiment_code: "SYLU-2026-06-201-A",
          axis_code: "x-",
          step_no: 3,
          status: "待执行",
        },
      ],
    };

    await mountPage();
    const axisButton = document.body.querySelector('[data-testid="laboratory-complete-axis-continue"]');

    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("实验进行中 1/3轴");
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("已完成：z-");
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("未完成：y+、x-");
    expect(axisButton?.textContent || "").toContain("当前轴向完成，进行下一轴向调整");
    expect(axisButton?.hasAttribute("disabled")).toBe(true);
    expect(laboratoryEndRequestCalls()).toHaveLength(0);
  });

  test("allows continuing the next axis within the same multi-axis schedule without an adjacent schedule", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-202", name: "振动同排程多轴任务", test_type: "振动试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-06-202",
          experiment_code: "SYLU-2026-06-202-A",
          experiment_name: "振动试验",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-202", experiment_code: "SYLU-2026-06-202-A", tray_code: "TP-VIB-202" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-vib-y-plus-x-minus",
          task_code: "SYLU-2026-06-202",
          experiment_code: "SYLU-2026-06-202-A",
          device: "振动一室",
          axis_codes: ["y+", "x-"],
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-202-SP-001",
          location: "振动一室",
          owner: "周工",
          status: "实验进行中",
          flow_status: "实验进行中",
          task_code: "SYLU-2026-06-202",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-VIB-202" }],
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "RUN-VIB-SAME-SCHEDULE",
          run_no: "RUN-VIB-SAME-SCHEDULE",
          schedule_id: "schedule-vib-y-plus-x-minus",
          task_code: "SYLU-2026-06-202",
          experiment_code: "SYLU-2026-06-202-A",
          device: "振动一室",
          tray_codes: ["TP-VIB-202"],
          status: "实验进行中",
          axis_codes: ["y+", "x-"],
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: [
        {
          run_no: "RUN-VIB-SAME-SCHEDULE",
          task_code: "SYLU-2026-06-202",
          experiment_code: "SYLU-2026-06-202-A",
          axis_code: "x-",
          step_no: 1,
          status: "实验进行中",
        },
        {
          run_no: "RUN-VIB-SAME-SCHEDULE",
          task_code: "SYLU-2026-06-202",
          experiment_code: "SYLU-2026-06-202-A",
          axis_code: "y+",
          step_no: 2,
          status: "待执行",
        },
      ],
    };

    await mountPage();
    const axisButton = document.body.querySelector('[data-testid="laboratory-complete-axis-continue"]');

    expect(document.body.querySelector(".laboratory-recent-task")?.textContent || "").toContain("轴向：x-、y+");
    expect(axisButton?.textContent || "").toContain("当前轴向完成，进行下一轴向调整");
    expect(axisButton?.hasAttribute("disabled")).toBe(false);
  });

  test("publishes the original run context after the next-axis fixture adjustment", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    const taskCode = "SYLU-2026-06-207";
    const experimentCode = `${taskCode}-A`;
    const runNo = "RUN-VIB-ADJUSTMENT";
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [{ code: taskCode, name: "振动轴向调整任务", test_type: "振动试验" }],
      [STORAGE_KEYS.experiments]: [{
        axis_codes: ["x+", "x-"],
        experiment_code: experimentCode,
        experiment_name: "振动试验",
        status: "实验进行中",
        task_code: taskCode,
      }],
      [STORAGE_KEYS.experiment_trays]: [{
        experiment_code: experimentCode,
        task_code: taskCode,
        tray_code: "TP-VIB-207",
      }],
      [STORAGE_KEYS.schedules]: [{
        axis_batch_no: "AXIS-BATCH-207",
        axis_codes: ["x+", "x-"],
        device: "振动一室",
        end_at: "2026-04-02T10:30:00.000Z",
        experiment_code: experimentCode,
        id: "schedule-vib-adjustment",
        start_at: "2026-04-02T09:30:00.000Z",
        status: "实验进行中",
        sub_experiment_code: "vib-adjustment-segment",
        task_code: taskCode,
      }],
      [STORAGE_KEYS.samples]: [{
        code: `${taskCode}-SP-001`,
        flow_status: "实验进行中",
        location: "振动一室",
        status: "实验进行中",
        task_code: taskCode,
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-VIB-207" }],
      }],
      [STORAGE_KEYS.experiment_runs]: [{
        axis_batch_no: "AXIS-BATCH-207",
        axis_codes: ["x+", "x-"],
        experiment_code: experimentCode,
        id: runNo,
        run_no: runNo,
        schedule_id: "schedule-vib-adjustment",
        status: "实验进行中",
        sub_experiment_code: "vib-adjustment-segment",
        task_code: taskCode,
        tray_codes: ["TP-VIB-207"],
      }],
      [STORAGE_KEYS.experiment_run_steps]: [
        { axis_code: "x+", experiment_code: experimentCode, run_no: runNo, status: "实验已完成", step_no: 1, task_code: taskCode },
        { axis_code: "x-", experiment_code: experimentCode, run_no: runNo, status: "轴向调整中", step_no: 2, task_code: taskCode },
      ],
    };

    await mountPage();
    const axisButton = document.body.querySelector('[data-testid="laboratory-complete-axis-continue"]');

    expect(axisButton?.textContent || "").toContain("下一轴向调整完成，可继续 x- 试验");
    expect(axisButton?.hasAttribute("disabled")).toBe(false);
    axisButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForLaboratoryMqCall("/api/mq/laboratory/ready");
    await flushPageUpdates();
    const readyCalls = laboratoryMqCalls().filter(([input]) => String(input).includes("/ready"));
    expect(readyCalls).toHaveLength(1);
    expect(JSON.parse(String(readyCalls[0][1]?.body || "{}"))).toEqual(expect.objectContaining({
      axis_adjustment_ready: true,
      axis_batch_no: "AXIS-BATCH-207",
      axis_codes: ["x+", "x-"],
      current_axis_code: "x-",
      experiment_code: experimentCode,
      lab_code: "LAB_VIBRATION_1",
      run_no: runNo,
      schedule_id: "schedule-vib-adjustment",
      sub_experiment_code: "vib-adjustment-segment",
      task_code: taskCode,
    }));
    expect(axisButton?.textContent || "").toContain("已准备就绪，等待 x- 轴向启动");
    expect(axisButton?.hasAttribute("disabled")).toBe(true);

    axisButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPageUpdates();
    expect(laboratoryMqCalls().filter(([input]) => String(input).includes("/ready"))).toHaveLength(1);
  });

  test("persists hostless axis adjustment readiness before the three-second local start", async () => {
    useHostInterfaceMode(HOST_INTERFACE_MODES.mqtt);
    reactiveRoute.query = { lab: "高低温湿热二室" };
    masterLabsState = [
      { code: "LAB_HOT_HUMID_2", name: "高低温湿热二室", type: "实验室", testTypeName: "高低温湿热试验", status: 1 },
    ];
    const taskCode = "SYLU-2026-06-208";
    const experimentCode = `${taskCode}-A`;
    const runNo = "RUN-HOSTLESS-ADJUSTMENT";
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [{ code: taskCode, name: "无上位机轴向调整任务", test_type: "高低温湿热试验" }],
      [STORAGE_KEYS.experiments]: [{
        axis_codes: ["x+", "x-"],
        experiment_code: experimentCode,
        experiment_name: "高低温湿热试验",
        status: "实验进行中",
        task_code: taskCode,
      }],
      [STORAGE_KEYS.experiment_trays]: [{ experiment_code: experimentCode, task_code: taskCode, tray_code: "TP-HOSTLESS-208" }],
      [STORAGE_KEYS.schedules]: [{
        axis_codes: ["x+", "x-"],
        device: "高低温湿热二室",
        end_at: "2026-04-02T12:00:00.000Z",
        experiment_code: experimentCode,
        id: "schedule-hostless-adjustment",
        start_at: "2026-04-02T09:30:00.000Z",
        status: "实验进行中",
        sub_experiment_code: "hostless-adjustment-segment",
        task_code: taskCode,
      }],
      [STORAGE_KEYS.samples]: [{
        code: `${taskCode}-SP-001`,
        flow_status: "实验进行中",
        location: "高低温湿热二室",
        status: "实验进行中",
        task_code: taskCode,
        trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-HOSTLESS-208" }],
      }],
      [STORAGE_KEYS.experiment_runs]: [{
        axis_codes: ["x+", "x-"],
        experiment_code: experimentCode,
        id: runNo,
        run_no: runNo,
        schedule_id: "schedule-hostless-adjustment",
        status: "实验进行中",
        sub_experiment_code: "hostless-adjustment-segment",
        task_code: taskCode,
        tray_codes: ["TP-HOSTLESS-208"],
      }],
      [STORAGE_KEYS.experiment_run_steps]: [
        { axis_code: "x+", experiment_code: experimentCode, run_no: runNo, status: "实验已完成", step_no: 1, task_code: taskCode },
        { axis_code: "x-", experiment_code: experimentCode, run_no: runNo, status: "轴向调整中", step_no: 2, task_code: taskCode },
      ],
    };

    await mountPage();
    const axisButton = document.body.querySelector('[data-testid="laboratory-complete-axis-continue"]');
    axisButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushPageUpdates();

    const adjustmentCalls = fetch.mock.calls.filter(([input]) => String(input).includes("/axis-adjustment-ready"));
    expect(adjustmentCalls).toHaveLength(1);
    expect(JSON.parse(String(adjustmentCalls[0][1]?.body || "{}"))).toEqual({
      axisCode: "x-",
      labCode: "LAB_HOT_HUMID_2",
      labName: "高低温湿热二室",
      runNo,
    });
    expect(laboratoryMqCalls()).toHaveLength(0);
    expect(axisButton?.textContent || "").toContain("已准备就绪，等待 x- 轴向启动");
    expect(laboratoryStartCalls()).toHaveLength(0);

    vi.advanceTimersByTime(2999);
    await flushPageUpdates();
    expect(laboratoryStartCalls()).toHaveLength(0);

    vi.advanceTimersByTime(1);
    await waitForLaboratoryStartCount(1);
    expect(JSON.parse(String(laboratoryStartCalls()[0][1]?.body || "{}"))).toEqual(expect.objectContaining({
      axisCodes: ["x+", "x-"],
      currentAxisCode: "x-",
      runNo,
      scheduleId: "schedule-hostless-adjustment",
      subExperimentCode: "hostless-adjustment-segment",
      trayCodes: ["TP-HOSTLESS-208"],
    }));
  });

  test("does not prompt attendance logout while continuing the next axis in the same schedule", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-206", name: "振动部分轴完成任务", test_type: "振动试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-06-206",
          experiment_code: "SYLU-2026-06-206-A",
          experiment_name: "振动试验",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-206", experiment_code: "SYLU-2026-06-206-A", tray_code: "TP-VIB-206" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-vib-partial-axis",
          task_code: "SYLU-2026-06-206",
          experiment_code: "SYLU-2026-06-206-A",
          device: "振动一室",
          axis_codes: ["x+", "y-"],
          sub_experiment_code: "vib-partial-axis-segment",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-206-SP-001",
          location: "振动一室",
          owner: "周工",
          status: "实验进行中",
          flow_status: "实验进行中",
          task_code: "SYLU-2026-06-206",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-VIB-206" }],
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "RUN-VIB-PARTIAL-AXIS",
          run_no: "RUN-VIB-PARTIAL-AXIS",
          schedule_id: "schedule-vib-partial-axis",
          task_code: "SYLU-2026-06-206",
          experiment_code: "SYLU-2026-06-206-A",
          device: "振动一室",
          tray_codes: ["TP-VIB-206"],
          status: "实验进行中",
          axis_codes: ["x+", "y-"],
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: [
        {
          run_no: "RUN-VIB-PARTIAL-AXIS",
          task_code: "SYLU-2026-06-206",
          experiment_code: "SYLU-2026-06-206-A",
          sub_experiment_code: "vib-partial-axis-segment",
          axis_code: "x+",
          step_no: 1,
          status: "实验进行中",
        },
        {
          run_no: "RUN-VIB-PARTIAL-AXIS",
          task_code: "SYLU-2026-06-206",
          experiment_code: "SYLU-2026-06-206-A",
          sub_experiment_code: "vib-partial-axis-segment",
          axis_code: "y-",
          step_no: 2,
          status: "待执行",
        },
      ],
    };

    await mountPage();
    document.body.querySelector('[data-testid="laboratory-complete-axis-continue"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForLaboratoryEndRequestCount(1);
    await flushPageUpdates();

    const completeBody = JSON.parse(String(laboratoryEndRequestCalls().at(-1)?.[1]?.body || "{}"));
    expect(completeBody).toEqual(expect.objectContaining({
      axis_code: "x+",
      next_axis_code: "y-",
      run_no: "RUN-VIB-PARTIAL-AXIS",
      sub_experiment_code: "vib-partial-axis-segment",
    }));
    expect(document.body.querySelector('[data-testid="laboratory-complete-experiment"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="laboratory-attendance-logout-prompt"].is-open')).toBeFalsy();
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("进行中");
    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").not.toContain("实验已完成");
    vi.advanceTimersByTime(30_000);
    await flushPageUpdates();
    expect(attendanceLogoutCalls()).toHaveLength(0);
  });

  test("allows continuing axes from the active run schedule when the selected schedule row has different axes", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-205", name: "振动排程选择错位任务", test_type: "振动试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-06-205",
          experiment_code: "SYLU-2026-06-205-A",
          experiment_name: "振动试验",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-205", experiment_code: "SYLU-2026-06-205-A", tray_code: "TP-VIB-205" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-vib-other-axis",
          task_code: "SYLU-2026-06-205",
          experiment_code: "SYLU-2026-06-205-A",
          device: "振动一室",
          axis_codes: ["z-"],
          start_at: "2026-04-02T09:00:00.000Z",
          end_at: "2026-04-02T09:30:00.000Z",
          status: "已排程",
        },
        {
          id: "schedule-vib-active-multi-axis",
          task_code: "SYLU-2026-06-205",
          experiment_code: "SYLU-2026-06-205-A",
          device: "振动一室",
          axis_codes: ["x+", "y-"],
          sub_experiment_code: "vib-current-axis-segment",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-205-SP-001",
          location: "振动一室",
          owner: "周工",
          status: "实验进行中",
          flow_status: "实验进行中",
          task_code: "SYLU-2026-06-205",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-VIB-205" }],
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "RUN-VIB-ACTIVE-SCHEDULE",
          run_no: "RUN-VIB-ACTIVE-SCHEDULE",
          schedule_id: "schedule-vib-active-multi-axis",
          task_code: "SYLU-2026-06-205",
          experiment_code: "SYLU-2026-06-205-A",
          device: "振动一室",
          tray_codes: ["TP-VIB-205"],
          status: "实验进行中",
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: [
        {
          run_no: "RUN-VIB-ACTIVE-SCHEDULE",
          task_code: "SYLU-2026-06-205",
          experiment_code: "SYLU-2026-06-205-A",
          axis_code: "x+",
          step_no: 1,
          status: "实验进行中",
        },
        {
          run_no: "RUN-VIB-ACTIVE-SCHEDULE",
          task_code: "SYLU-2026-06-205",
          experiment_code: "SYLU-2026-06-205-A",
          axis_code: "y-",
          step_no: 2,
          status: "待执行",
        },
      ],
    };

    await mountPage();
    const axisButton = document.body.querySelector('[data-testid="laboratory-complete-axis-continue"]');

    expect(axisButton?.textContent || "").toContain("当前轴向完成，进行下一轴向调整");
    expect(axisButton?.hasAttribute("disabled")).toBe(false);
  });

  test("keeps axis continuation disabled when the active schedule has no multi-axis requirement", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-203", name: "振动轴向兼容任务", test_type: "振动试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-06-203",
          experiment_code: "SYLU-2026-06-203-A",
          experiment_name: "振动试验",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-203", experiment_code: "SYLU-2026-06-203-A", tray_code: "TP-VIB-203" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-vib-no-axis-field",
          task_code: "SYLU-2026-06-203",
          experiment_code: "SYLU-2026-06-203-A",
          device: "振动一室",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-203-SP-001",
          location: "振动一室",
          owner: "周工",
          status: "实验进行中",
          flow_status: "实验进行中",
          task_code: "SYLU-2026-06-203",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-VIB-203" }],
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "RUN-VIB-FALLBACK",
          run_no: "RUN-VIB-FALLBACK",
          schedule_id: "schedule-vib-no-axis-field",
          task_code: "SYLU-2026-06-203",
          experiment_code: "SYLU-2026-06-203-A",
          device: "振动一室",
          tray_codes: ["TP-VIB-203"],
          status: "实验进行中",
          axis_codes: ["x+", "y-"],
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: [
        {
          run_no: "RUN-VIB-FALLBACK",
          task_code: "SYLU-2026-06-203",
          experiment_code: "SYLU-2026-06-203-A",
          axis_code: "x+",
          step_no: 1,
          status: "实验进行中",
        },
        {
          run_no: "RUN-VIB-FALLBACK",
          task_code: "SYLU-2026-06-203",
          experiment_code: "SYLU-2026-06-203-A",
          axis_code: "y-",
          step_no: 2,
          status: "待执行",
        },
      ],
    };

    await mountPage();
    const axisButton = document.body.querySelector('[data-testid="laboratory-complete-axis-continue"]');

    expect(axisButton?.textContent || "").toContain("当前轴向完成，进行下一轴向调整");
    expect(axisButton?.hasAttribute("disabled")).toBe(true);
  });

  test("uses the unified axis action to complete the final axis and finish the experiment", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-204", name: "振动当前轴完成任务", test_type: "振动试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-06-204",
          experiment_code: "SYLU-2026-06-204-A",
          experiment_name: "振动试验",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-204", experiment_code: "SYLU-2026-06-204-A", tray_code: "TP-VIB-204" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-vib-current-axis",
          task_code: "SYLU-2026-06-204",
          experiment_code: "SYLU-2026-06-204-A",
          device: "振动一室",
          axis_codes: ["x+"],
          sub_experiment_code: "vib-current-axis-segment",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-204-SP-001",
          location: "振动一室",
          owner: "周工",
          status: "实验进行中",
          flow_status: "实验进行中",
          task_code: "SYLU-2026-06-204",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-VIB-204" }],
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "RUN-VIB-CURRENT-AXIS",
          run_no: "RUN-VIB-CURRENT-AXIS",
          schedule_id: "schedule-vib-current-axis",
          task_code: "SYLU-2026-06-204",
          experiment_code: "SYLU-2026-06-204-A",
          device: "振动一室",
          tray_codes: ["TP-VIB-204"],
          status: "实验进行中",
          axis_codes: ["x+"],
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
      [STORAGE_KEYS.experiment_run_steps]: [
        {
          run_no: "RUN-VIB-CURRENT-AXIS",
          task_code: "SYLU-2026-06-204",
          experiment_code: "SYLU-2026-06-204-A",
          axis_code: "x+",
          step_no: 1,
          status: "实验进行中",
        },
      ],
    };

    await mountPage();
    const completeButton = document.body.querySelector('[data-testid="laboratory-complete-axis-continue"]');

    expect(document.body.querySelector('[data-testid="laboratory-complete-experiment"]')).toBeNull();
    expect(completeButton?.textContent || "").toContain("当前轴向完成，完成本试验");
    completeButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await waitForLaboratoryEndRequestCount(1);

    const completeBody = JSON.parse(String(laboratoryEndRequestCalls().at(-1)?.[1]?.body || "{}"));
    expect(completeBody).toEqual(expect.objectContaining({
      axis_code: "x+",
      run_no: "RUN-VIB-CURRENT-AXIS",
      sub_experiment_code: "vib-current-axis-segment",
    }));
    expect(completeBody.next_axis_code).toBe("");
    expect(document.body.querySelector('[data-testid="laboratory-attendance-logout-prompt"].is-open')).toBeTruthy();
  });

  test("prompts attendance logout when a running axis experiment completes from storage refresh", async () => {
    reactiveRoute.query = { lab: "振动一室" };
    masterLabsState = [
      { code: "LAB_VIBRATION_1", name: "振动一室", type: "实验室", testTypeName: "振动试验", status: 1 },
    ];
    snapshotState = {
      ...createSnapshot(),
      [STORAGE_KEYS.tasks]: [
        { code: "SYLU-2026-06-207", name: "振动外部完成任务", test_type: "振动试验" },
      ],
      [STORAGE_KEYS.experiments]: [
        {
          task_code: "SYLU-2026-06-207",
          experiment_code: "SYLU-2026-06-207-A",
          experiment_name: "振动试验",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.experiment_trays]: [
        { task_code: "SYLU-2026-06-207", experiment_code: "SYLU-2026-06-207-A", tray_code: "TP-VIB-207" },
      ],
      [STORAGE_KEYS.schedules]: [
        {
          id: "schedule-vib-external-complete",
          task_code: "SYLU-2026-06-207",
          experiment_code: "SYLU-2026-06-207-A",
          device: "振动一室",
          axis_codes: ["x+"],
          sub_experiment_code: "vib-external-axis-segment",
          start_at: "2026-04-02T09:30:00.000Z",
          end_at: "2026-04-02T10:30:00.000Z",
          status: "实验进行中",
        },
      ],
      [STORAGE_KEYS.samples]: [
        {
          code: "SYLU-2026-06-207-SP-001",
          location: "振动一室",
          owner: "周工",
          status: "实验进行中",
          flow_status: "实验进行中",
          task_code: "SYLU-2026-06-207",
          trays: [{ quantity: 1, status: "实验进行中", tray_code: "TP-VIB-207" }],
        },
      ],
      [STORAGE_KEYS.experiment_runs]: [
        {
          id: "RUN-VIB-EXTERNAL-COMPLETE",
          run_no: "RUN-VIB-EXTERNAL-COMPLETE",
          schedule_id: "schedule-vib-external-complete",
          task_code: "SYLU-2026-06-207",
          experiment_code: "SYLU-2026-06-207-A",
          device: "振动一室",
          tray_codes: ["TP-VIB-207"],
          status: "实验进行中",
          axis_codes: ["x+"],
          started_at: "2026-04-02T09:30:00.000Z",
          planned_end_at: "2026-04-02T10:30:00.000Z",
        },
      ],
    };

    await mountPage();
    snapshotState = {
      ...snapshotState,
      [STORAGE_KEYS.experiment_runs]: snapshotState[STORAGE_KEYS.experiment_runs].map((run) =>
        run.run_no === "RUN-VIB-EXTERNAL-COMPLETE"
          ? { ...run, ended_at: "2026-04-02T10:00:00.000Z", status: "实验已完成", updated_at: "2026-04-02T10:00:00.000Z" }
          : run,
      ),
    };
    const expectedStorageGetCalls = storageGetCalls().length + 1;
    window.dispatchEvent(new CustomEvent(SNAPSHOT_UPDATED_EVENT, {
      detail: { keys: [STORAGE_KEYS.samples, STORAGE_KEYS.experiment_runs] },
    }));
    await waitForStorageGetCount(expectedStorageGetCalls, { advanceStorageDebounce: true });
    await flushPageUpdates();

    expect(document.body.querySelector('[data-testid="laboratory-running-modal"]')?.textContent || "").toContain("实验已完成");
    expect(document.body.querySelector('[data-testid="laboratory-attendance-logout-prompt"].is-open')).toBeTruthy();
  });
});
