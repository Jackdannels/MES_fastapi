/* FILE: seed.js
 * Seeds demo data and versioned resets into localStorage.
 */
import { STORAGE_KEYS, isRemoteStoreEnabled, loadStore, saveStore } from "./storage.js";
import { generateId, formatDateTime } from "./utils.js";

// Versioned seed markers for localStorage resets.
const SEED_VERSION = "2024-06-25";
const SEED_MARK = "mes.seed.version";
const SAMPLE_SEED_VERSION = "2026-01-20";
const SAMPLE_SEED_MARK = "mes.seed.samples.version";
const TASK_CLEAR_VERSION = "2026-02-02";
const TASK_CLEAR_MARK = "mes.tasks.clear.version";

function shouldResetSeed() {
  if (isRemoteStoreEnabled()) {
    return false;
  }
  try {
    return localStorage.getItem(SEED_MARK) !== SEED_VERSION;
  } catch {
    return true;
  }
}

function markSeeded() {
  if (isRemoteStoreEnabled()) {
    return;
  }
  try {
    localStorage.setItem(SEED_MARK, SEED_VERSION);
  } catch {
    return;
  }
}

function shouldResetSampleSeed() {
  if (isRemoteStoreEnabled()) {
    return false;
  }
  try {
    return localStorage.getItem(SAMPLE_SEED_MARK) !== SAMPLE_SEED_VERSION;
  } catch {
    return true;
  }
}

function shouldClearTasks() {
  if (isRemoteStoreEnabled()) {
    return false;
  }
  try {
    return localStorage.getItem(TASK_CLEAR_MARK) !== TASK_CLEAR_VERSION;
  } catch {
    return true;
  }
}

function markTasksCleared() {
  try {
    localStorage.setItem(TASK_CLEAR_MARK, TASK_CLEAR_VERSION);
  } catch {
    return;
  }
}

function markSampleSeeded() {
  try {
    localStorage.setItem(SAMPLE_SEED_MARK, SAMPLE_SEED_VERSION);
  } catch {
    return;
  }
}

function buildSeed(labels) {
  const now = new Date();
  const createdAt = now.toISOString();
  const offset = (hours) => new Date(now.getTime() + hours * 60 * 60 * 1000);
  const textTime = (hours) => formatDateTime(offset(hours));
  const isoTime = (hours) => offset(hours).toISOString();

  const tasks = [
    {
      id: generateId("task"),
      code: "CJ-2024-001",
      name: "冲击试验-批次A",
      source: labels.sourceExternal,
      priority: "高",
      sample_count: 12,
      sample_type: "结构件",
      test_type: "冲击试验",
      required_device: "冲击试验",
      due_at: textTime(24),
      arrival_at: textTime(4),
      status: labels.statusScheduled,
      created_at: createdAt,
    },
    {
      id: generateId("task"),
      code: "ZD-2024-002",
      name: "振动试验-批次B",
      source: labels.sourceInternal,
      priority: "中",
      sample_count: 8,
      sample_type: "电子组件",
      test_type: "振动试验",
      required_device: "振动试验",
      due_at: textTime(30),
      arrival_at: textTime(8),
      status: labels.statusWaiting,
      created_at: createdAt,
    },
    {
      id: generateId("task"),
      code: "SZH-2024-003",
      name: "四综合试验-批次C",
      source: labels.sourceExternal,
      priority: "高",
      sample_count: 6,
      sample_type: "整机样机",
      test_type: "四综合试验",
      required_device: "四综合试验",
      due_at: textTime(12),
      arrival_at: textTime(-1),
      status: labels.statusRunning,
      created_at: createdAt,
    },
    {
      id: generateId("task"),
      code: "WDC-2024-004",
      name: "温度冲击试验-批次D",
      source: labels.sourceExternal,
      priority: "中",
      sample_count: 5,
      sample_type: "塑料件",
      test_type: "温度冲击试验",
      required_device: "温度冲击试验",
      due_at: textTime(20),
      arrival_at: textTime(3),
      status: labels.statusAccepted,
      created_at: createdAt,
    },
    {
      id: generateId("task"),
      code: "GDW-2024-005",
      name: "高低温湿热试验-批次E",
      source: labels.sourceInternal,
      priority: "低",
      sample_count: 4,
      sample_type: "电源模块",
      test_type: "高低温湿热试验",
      required_device: "高低温湿热试验",
      due_at: textTime(48),
      arrival_at: textTime(10),
      status: labels.statusWaiting,
      created_at: createdAt,
    },
    {
      id: generateId("task"),
      code: "YW-2024-006",
      name: "盐雾试验-批次F",
      source: labels.sourceExternal,
      priority: "中",
      sample_count: 9,
      sample_type: "金属件",
      test_type: "盐雾试验",
      required_device: "盐雾试验",
      due_at: textTime(36),
      arrival_at: textTime(6),
      status: labels.statusScheduled,
      created_at: createdAt,
    },
    {
      id: generateId("task"),
      code: "MJ-2024-007",
      name: "霉菌试验-批次G",
      source: labels.sourceInternal,
      priority: "中",
      sample_count: 3,
      sample_type: "橡胶件",
      test_type: "霉菌试验",
      required_device: "霉菌试验",
      due_at: textTime(60),
      arrival_at: textTime(12),
      status: labels.statusAccepted,
      created_at: createdAt,
    },
  ];

  const devices = [
    {
      id: generateId("device"),
      code: "冲击一室",
      name: "冲击试验系统-1",
      type: "冲击试验",
      status: labels.deviceIdle,
      location: "冲击一室",
      next_cal: "2024-07-10",
    },
    {
      id: generateId("device"),
      code: "冲击二室",
      name: "冲击试验系统-2",
      type: "冲击试验",
      status: labels.deviceIdle,
      location: "冲击二室",
      next_cal: "2024-07-11",
    },
    {
      id: generateId("device"),
      code: "振动一室",
      name: "振动试验系统-1",
      type: "振动试验",
      status: labels.deviceIdle,
      location: "振动一室",
      next_cal: "2024-07-12",
    },
    {
      id: generateId("device"),
      code: "振动二室",
      name: "振动试验系统-2",
      type: "振动试验",
      status: labels.deviceIdle,
      location: "振动二室",
      next_cal: "2024-07-13",
    },
    {
      id: generateId("device"),
      code: "四综合实验室",
      name: "四综合试验系统",
      type: "四综合试验",
      status: labels.deviceIdle,
      location: "四综合实验室",
      next_cal: "2024-07-05",
    },
    {
      id: generateId("device"),
      code: "温度冲击一室",
      name: "温度冲击系统-1",
      type: "温度冲击试验",
      status: labels.deviceIdle,
      location: "温度冲击一室",
      next_cal: "2024-07-15",
    },
    {
      id: generateId("device"),
      code: "温度冲击二室",
      name: "温度冲击系统-2",
      type: "温度冲击试验",
      status: labels.deviceIdle,
      location: "温度冲击二室",
      next_cal: "2024-07-16",
    },
    {
      id: generateId("device"),
      code: "高低温湿热一室",
      name: "高低温湿热系统",
      type: "高低温湿热试验",
      status: labels.deviceMaintenance,
      location: "高低温湿热一室",
      next_cal: "2024-06-30",
    },
    {
      id: generateId("device"),
      code: "盐雾试验室",
      name: "盐雾试验箱",
      type: "盐雾试验",
      status: labels.deviceIdle,
      location: "盐雾试验室",
      next_cal: "2024-07-02",
    },
    {
      id: generateId("device"),
      code: "霉菌试验室",
      name: "霉菌培养箱",
      type: "霉菌试验",
      status: labels.deviceIdle,
      location: "霉菌试验室",
      next_cal: "2024-07-08",
    },
  ];

  const samples = [
    {
      id: generateId("sample"),
      code: "SP-2601-01",
      task_code: "CJ-2024-001",
      location: labels.intakeLocation,
      owner: "收样台",
      status: labels.sampleReceived,
      created_at: isoTime(-6),
    },
    {
      id: generateId("sample"),
      code: "SP-2601-02",
      task_code: "CJ-2024-001",
      location: labels.retentionLocation,
      owner: "样品库",
      status: labels.sampleStored,
      created_at: isoTime(-5),
      history: [
        {
          id: generateId("sample-event"),
          time: isoTime(-6),
          action: "样品登记",
          location: labels.intakeLocation,
          owner: "收样台",
          status: labels.sampleReceived,
          detail: "",
        },
        {
          id: generateId("sample-event"),
          time: isoTime(-5),
          action: "送达暂存间",
          location: labels.retentionLocation,
          owner: "样品库",
          status: labels.sampleStored,
          detail: "",
        },
      ],
    },
    {
      id: generateId("sample"),
      code: "SP-2601-03",
      task_code: "SZH-2024-003",
      location: "四综合实验室",
      owner: "王工",
      status: labels.sampleTesting,
      created_at: isoTime(-8),
      history: [
        {
          id: generateId("sample-event"),
          time: isoTime(-9),
          action: "样品登记",
          location: labels.intakeLocation,
          owner: "收样台",
          status: labels.sampleReceived,
          detail: "",
        },
        {
          id: generateId("sample-event"),
          time: isoTime(-8),
          action: "暂存间派发",
          location: "四综合实验室",
          owner: "王工",
          status: labels.sampleTesting,
          detail: "",
        },
      ],
    },
    {
      id: generateId("sample"),
      code: "SP-2601-04",
      task_code: "YW-2024-006",
      location: "盐雾试验室",
      owner: "李工",
      status: labels.sampleTesting,
      created_at: isoTime(-7),
      history: [
        {
          id: generateId("sample-event"),
          time: isoTime(-8),
          action: "样品登记",
          location: labels.intakeLocation,
          owner: "收样台",
          status: labels.sampleReceived,
          detail: "",
        },
        {
          id: generateId("sample-event"),
          time: isoTime(-7),
          action: "暂存间派发",
          location: "盐雾试验室",
          owner: "李工",
          status: labels.sampleTesting,
          detail: "",
        },
      ],
    },
    {
      id: generateId("sample"),
      code: "SP-2601-05",
      task_code: "GDW-2024-005",
      location: labels.retentionLocation,
      owner: "样品库",
      status: labels.sampleStored,
      created_at: isoTime(-4),
      history: [
        {
          id: generateId("sample-event"),
          time: isoTime(-4.5),
          action: "样品登记",
          location: labels.intakeLocation,
          owner: "收样台",
          status: labels.sampleReceived,
          detail: "",
        },
        {
          id: generateId("sample-event"),
          time: isoTime(-4),
          action: "送达暂存间",
          location: labels.retentionLocation,
          owner: "样品库",
          status: labels.sampleStored,
          detail: "",
        },
      ],
    },
    {
      id: generateId("sample"),
      code: "SP-2601-06",
      task_code: "WDC-2024-004",
      location: "温度冲击一室",
      owner: "赵工",
      status: labels.sampleTesting,
      created_at: isoTime(-3),
      history: [
        {
          id: generateId("sample-event"),
          time: isoTime(-3.5),
          action: "样品登记",
          location: labels.intakeLocation,
          owner: "收样台",
          status: labels.sampleReceived,
          detail: "",
        },
        {
          id: generateId("sample-event"),
          time: isoTime(-3),
          action: "暂存间派发",
          location: "温度冲击一室",
          owner: "赵工",
          status: labels.sampleTesting,
          detail: "",
        },
      ],
    },
    {
      id: generateId("sample"),
      code: "SP-2601-07",
      task_code: "MJ-2024-007",
      location: labels.intakeLocation,
      owner: "收样台",
      status: labels.sampleReceived,
      created_at: isoTime(-2),
    },
  ];

  const schedules = [
    {
      id: generateId("schedule"),
      task_code: "SZH-2024-003",
      device: "四综合实验室",
      start_at: isoTime(-1),
      end_at: isoTime(2),
      status: labels.statusRunning,
    },
    {
      id: generateId("schedule"),
      task_code: "CJ-2024-001",
      device: "冲击一室",
      start_at: isoTime(3),
      end_at: isoTime(5),
      status: labels.statusScheduled,
    },
    {
      id: generateId("schedule"),
      task_code: "YW-2024-006",
      device: "盐雾试验室",
      start_at: isoTime(6),
      end_at: isoTime(12),
      status: labels.statusScheduled,
    },
  ];

  const streams = [
    {
      id: generateId("stream"),
      task_code: "SZH-2024-003",
      device: "四综合实验室",
      last_packet: formatDateTime(now),
      quality: "99.2%",
      status: labels.dataStreaming,
      reported: false,
    },
    {
      id: generateId("stream"),
      task_code: "CJ-2024-001",
      device: "冲击一室",
      last_packet: formatDateTime(offset(-0.5)),
      quality: "96.5%",
      status: labels.dataGap,
      reported: false,
    },
    {
      id: generateId("stream"),
      task_code: "YW-2024-006",
      device: "盐雾试验室",
      last_packet: formatDateTime(offset(-2)),
      quality: "99.6%",
      status: labels.dataComplete,
      reported: false,
    },
  ];

  return { tasks, devices, samples, schedules, streams };
}

function applySeed(seed) {
  saveStore(STORAGE_KEYS.tasks, seed.tasks);
  saveStore(STORAGE_KEYS.devices, seed.devices);
  saveStore(STORAGE_KEYS.samples, seed.samples);
  saveStore(STORAGE_KEYS.schedules, seed.schedules);
  saveStore(STORAGE_KEYS.streams, seed.streams);
  saveStore(STORAGE_KEYS.conflicts, []);
}

function ensureDevices(devices, seedDevices) {
  const existing = new Set(devices.map((device) => device.code));
  let changed = false;
  seedDevices.forEach((device) => {
    if (!existing.has(device.code)) {
      devices.push(device);
      existing.add(device.code);
      changed = true;
    }
  });
  return changed;
}

function removeLegacyLabEntries(tasks, devices, samples, schedules, streams) {
  const removedDevice = "外观检测室";
  let changed = false;

  const filteredDevices = devices.filter((device) => device.code !== removedDevice);
  if (filteredDevices.length !== devices.length) {
    devices.length = 0;
    devices.push(...filteredDevices);
    changed = true;
  }

  const filteredSchedules = schedules.filter((entry) => entry.device !== removedDevice);
  if (filteredSchedules.length !== schedules.length) {
    schedules.length = 0;
    schedules.push(...filteredSchedules);
    changed = true;
  }

  const filteredStreams = streams.filter((entry) => entry.device !== removedDevice);
  if (filteredStreams.length !== streams.length) {
    streams.length = 0;
    streams.push(...filteredStreams);
    changed = true;
  }

  const filteredSamples = samples.filter((sample) => sample.location !== removedDevice);
  if (filteredSamples.length !== samples.length) {
    samples.length = 0;
    samples.push(...filteredSamples);
    changed = true;
  }

  const filteredTasks = tasks.filter((task) => task.test_type !== "外观检测");
  if (filteredTasks.length !== tasks.length) {
    tasks.length = 0;
    tasks.push(...filteredTasks);
    changed = true;
  }

  return changed;
}

function renameLabEntries(devices, samples, schedules, streams, mapping) {
  let changed = false;
  const applyMapping = (value) => mapping[value] || value;

  devices.forEach((device) => {
    const nextCode = applyMapping(device.code);
    const nextLocation = applyMapping(device.location);
    if (nextCode !== device.code) {
      device.code = nextCode;
      changed = true;
    }
    if (nextLocation !== device.location) {
      device.location = nextLocation;
      changed = true;
    }
  });

  schedules.forEach((entry) => {
    const nextDevice = applyMapping(entry.device);
    if (nextDevice !== entry.device) {
      entry.device = nextDevice;
      changed = true;
    }
  });

  streams.forEach((entry) => {
    const nextDevice = applyMapping(entry.device);
    if (nextDevice !== entry.device) {
      entry.device = nextDevice;
      changed = true;
    }
  });

  samples.forEach((sample) => {
    const nextLocation = applyMapping(sample.location);
    if (nextLocation !== sample.location) {
      sample.location = nextLocation;
      changed = true;
    }
  });

  return changed;
}

function seedData(labels) {
  const seed = buildSeed(labels);
  const clearTasks = shouldClearTasks();
  if (clearTasks) {
    seed.tasks = [];
    seed.schedules = [];
    seed.streams = [];
  }
  const needsReset = shouldResetSeed();
  const tasks = loadStore(STORAGE_KEYS.tasks, []);
  const devices = loadStore(STORAGE_KEYS.devices, []);
  const samples = loadStore(STORAGE_KEYS.samples, []);
  const schedules = loadStore(STORAGE_KEYS.schedules, []);
  const streams = loadStore(STORAGE_KEYS.streams, []);

  if (
    needsReset ||
    tasks.length === 0 ||
    devices.length === 0 ||
    samples.length === 0 ||
    schedules.length === 0 ||
    streams.length === 0
  ) {
    applySeed(seed);
    if (needsReset) {
      markSeeded();
    }
    markSampleSeeded();
    if (clearTasks) {
      markTasksCleared();
    }
    return;
  }

  let updated = false;
  if (ensureDevices(devices, seed.devices)) {
    updated = true;
  }
  if (removeLegacyLabEntries(tasks, devices, samples, schedules, streams)) {
    updated = true;
  }
  if (
    renameLabEntries(devices, samples, schedules, streams, {
      四综合室: "四综合实验室",
    })
  ) {
    updated = true;
  }
  if (clearTasks) {
    tasks.length = 0;
    schedules.length = 0;
    streams.length = 0;
    saveStore(STORAGE_KEYS.conflicts, []);
    updated = true;
    markTasksCleared();
  }

  if (shouldResetSampleSeed()) {
    samples.length = 0;
    samples.push(...seed.samples);
    updated = true;
    markSampleSeeded();
  }
  if (updated) {
    saveStore(STORAGE_KEYS.tasks, tasks);
    saveStore(STORAGE_KEYS.devices, devices);
    saveStore(STORAGE_KEYS.samples, samples);
    saveStore(STORAGE_KEYS.schedules, schedules);
    saveStore(STORAGE_KEYS.streams, streams);
  }
}

export { seedData };
