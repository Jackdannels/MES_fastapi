const STATUS_TRANSIT = "运输中";
const STATUS_WAITING = "待排程";

const normalizeText = (value) => String(value ?? "").trim();
const asArray = (value) => (Array.isArray(value) ? value : []);

const createId = (prefix, now = new Date().toISOString()) => {
  const safeNow = String(now).replace(/[^0-9]/g, "").slice(0, 14) || "0";
  const random = Math.floor(Math.random() * 1000)
    .toString()
    .padStart(3, "0");
  return `${prefix}-${safeNow}-${random}`;
};

const createSampleIntakeForm = () => ({
  code: "",
  task_code: "",
  sample_type: "",
  batch_no: "",
  arrival_at: "",
  quantity: "",
  storage_condition: "",
  barcode: "",
  remark: "",
});

const buildSampleIntakeTaskOptions = (tasks = []) =>
  asArray(tasks)
    .map((task) => ({
      code: normalizeText(task?.code),
      label: [normalizeText(task?.code), normalizeText(task?.name)].filter(Boolean).join(" | "),
    }))
    .filter((task) => task.code)
    .sort((left, right) => left.code.localeCompare(right.code, "zh-Hans-CN"));

const nextTaskSampleCode = (taskCode, samples = []) => {
  const code = normalizeText(taskCode);
  if (!code) {
    return "";
  }
  const pattern = new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-SP-(\\d{3})$`);
  let maxIndex = 0;
  asArray(samples).forEach((sample) => {
    const sampleCode = normalizeText(sample?.code);
    const match = sampleCode.match(pattern);
    if (!match) {
      return;
    }
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index);
    }
  });
  return `${code}-SP-${String(maxIndex + 1).padStart(3, "0")}`;
};

const appendSampleHistory = (sample, action, detail = "", nowIso) => {
  const history = Array.isArray(sample.history) ? sample.history.slice() : [];
  history.unshift({
    id: createId("sample-event", nowIso),
    time: nowIso,
    action,
    location: normalizeText(sample.location),
    owner: normalizeText(sample.owner),
    status: normalizeText(sample.status),
    detail: normalizeText(detail),
  });
  return history;
};

const buildFallbackSampleCode = (now = new Date()) => `SP-${String(now.getTime()).slice(-6)}`;

function submitSampleIntake(input = {}) {
  const form = input.form && typeof input.form === "object" ? input.form : createSampleIntakeForm();
  const mode = normalizeText(input.mode) === "draft" ? "draft" : "submit";
  const now = input.now || new Date().toISOString();
  const tasks = asArray(input.tasks).map((task) => ({ ...task }));
  const samples = asArray(input.samples).map((sample) => ({ ...sample }));
  const taskCode = normalizeText(form.task_code);
  const task = tasks.find((item) => normalizeText(item?.code) === taskCode) || null;

  let nextCode = normalizeText(form.code);
  if (!nextCode && taskCode) {
    nextCode = nextTaskSampleCode(taskCode, samples);
  }
  if (!nextCode) {
    nextCode = buildFallbackSampleCode(new Date(now));
  }

  if (samples.some((item) => normalizeText(item?.code) === nextCode)) {
    return { error: `样品编号 ${nextCode} 已存在。`, tasks, samples };
  }

  const plannedCount = Number.parseInt(task?.sample_count, 10);
  if (task && Number.isFinite(plannedCount) && plannedCount >= 0) {
    const existingCount = samples.filter((item) => normalizeText(item?.task_code) === normalizeText(task.code)).length;
    if (existingCount >= plannedCount) {
      return { error: `任务 ${task.code} 的样品数量已达到 ${plannedCount}。`, tasks, samples };
    }
  }

  const sample = {
    id: createId("sample", now),
    code: nextCode,
    task_code: taskCode,
    sample_type: normalizeText(form.sample_type),
    batch_no: normalizeText(form.batch_no),
    arrival_at: normalizeText(form.arrival_at),
    quantity: normalizeText(form.quantity),
    storage_condition: normalizeText(form.storage_condition),
    barcode: normalizeText(form.barcode),
    remark: normalizeText(form.remark),
    location: "",
    owner: "",
    status: STATUS_TRANSIT,
    flow_status: STATUS_TRANSIT,
    created_at: now,
    updated_at: now,
  };
  sample.history = appendSampleHistory(sample, "样品登记", mode === "draft" ? "保存草稿" : "", now);
  samples.unshift(sample);

  if (mode === "submit" && task && normalizeText(task.status) === "已受理") {
    task.status = STATUS_WAITING;
    task.updated_at = now;
  }

  return {
    error: "",
    tasks,
    samples,
    sample,
    nextForm: createSampleIntakeForm(),
  };
}

export { buildSampleIntakeTaskOptions, createSampleIntakeForm, nextTaskSampleCode, submitSampleIntake };
