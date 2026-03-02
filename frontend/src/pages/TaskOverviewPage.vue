<template>
  <section class="card section">
    <div class="task-overview-header">
      <h3>任务总览</h3>
      <div class="task-overview-actions">
        <input v-model.trim="keyword" class="search-input" placeholder="按任务编号/任务类型/样品编号筛选" />
        <select v-model="timeFilter" class="search-input">
          <option value="all">全部时间</option>
          <option value="today">今天</option>
          <option value="last7">近7天</option>
          <option value="last30">近30天</option>
          <option value="thisYear">本年</option>
        </select>
        <select v-model="testTypeFilter" class="search-input">
          <option value="">全部实验类型</option>
          <option v-for="type in testTypeOptions" :key="type" :value="type">{{ type }}</option>
        </select>
        <button class="action-btn secondary" type="button" @click="loadOverview">刷新数据</button>
      </div>
    </div>

    <div v-if="loading" class="muted">正在加载任务明细...</div>
    <div v-else-if="filteredRows.length === 0" class="muted">暂无可展示的任务信息。</div>

    <div v-else class="task-overview-list">
      <article v-for="(row, index) in filteredRows" :key="row.taskCode" class="task-overview-card">
        <div class="task-overview-index-col">
          <div class="task-overview-index-label">序号</div>
          <div class="task-overview-index-value">{{ index + 1 }}</div>
        </div>

        <div class="task-overview-content">
          <div class="task-overview-main">
            <div class="task-overview-headline">
              <div class="task-overview-title">{{ row.taskCode }}</div>
              <button class="action-btn secondary task-overview-edit-btn" type="button" @click="openEdit(row)">
                {{ isEditing(row.taskCode) ? "收起编辑" : "编辑任务" }}
              </button>
            </div>
            <div class="task-overview-meta">
              <span>任务类型：{{ row.taskType || "-" }}</span>
              <span>当前状态：{{ row.currentStatus }}</span>
              <span>是否排期：{{ row.scheduleLabel }}</span>
              <span>样品数量：{{ row.sampleCount }} / {{ row.plannedCount || "-" }}</span>
              <span>托盘数量：{{ row.trays.length }}</span>
            </div>
          </div>

          <div v-if="isEditing(row.taskCode)" class="task-overview-editor">
            <div class="task-overview-editor-grid">
              <label class="task-overview-editor-field">
                <span>任务类型</span>
                <select v-model="editForm.taskType" class="search-input">
                  <option value="">请选择任务类型</option>
                  <option v-for="type in taskTypeEditOptions" :key="type" :value="type">{{ type }}</option>
                </select>
              </label>
              <label class="task-overview-editor-field">
                <span>样品数量</span>
                <input v-model.number="editForm.sampleCount" class="search-input" type="number" min="0" step="1" />
              </label>
              <label class="task-overview-editor-field task-overview-editor-field-full">
                <span>样品编号（换行/逗号分隔）</span>
                <textarea
                  v-model="editForm.sampleCodesText"
                  class="search-input task-overview-editor-textarea"
                  placeholder="例如：CJ-2026-007-SP-001"
                ></textarea>
              </label>
            </div>

            <div v-if="editError" class="form-alert">{{ editError }}</div>
            <div v-if="editMessage" class="task-overview-success">{{ editMessage }}</div>

            <div class="form-actions">
              <button
                class="action-btn"
                type="button"
                :disabled="savingTaskCode === row.taskCode"
                @click="saveEdit(row.taskCode)"
              >
                {{ savingTaskCode === row.taskCode ? "保存中..." : "保存修改" }}
              </button>
              <button class="action-btn secondary" type="button" @click="generateCodesByCount">
                按数量自动生成编号
              </button>
              <button class="action-btn secondary" type="button" @click="cancelEdit">取消</button>
            </div>
          </div>

          <div class="task-overview-block">
            <div class="task-overview-label">样品编号</div>
            <div class="task-overview-codes">
              <span v-for="code in row.sampleCodes" :key="code" class="task-overview-chip">{{ code }}</span>
            </div>
          </div>

          <div class="task-overview-block">
            <div class="task-overview-label">托盘分配情况</div>
            <div v-if="row.trays.length === 0" class="muted">未分配托盘</div>
            <table v-else class="table task-overview-table">
              <thead>
                <tr>
                  <th>托盘编号</th>
                  <th>样品编号</th>
                  <th>数量合计</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="tray in row.trays" :key="tray.trayCode">
                  <td>{{ tray.trayCode }}</td>
                  <td>{{ tray.sampleCodes.join("、") }}</td>
                  <td>{{ tray.totalQuantity }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";

const STORAGE_KEYS = {
  tasks: "mes.tasks",
  samples: "mes.samples",
  schedules: "mes.schedules",
};

const loading = ref(false);
const keyword = ref("");
const timeFilter = ref("all");
const testTypeFilter = ref("");
const rows = ref([]);
const editingTaskCode = ref("");
const savingTaskCode = ref("");
const editError = ref("");
const editMessage = ref("");
const editForm = ref({
  taskCode: "",
  taskType: "",
  sampleCount: 0,
  sampleCodesText: "",
});

const parseJson = (raw, fallback) => {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

const readLocalArray = (key) => {
  if (typeof window === "undefined") {
    return [];
  }
  const parsed = parseJson(window.localStorage.getItem(key), []);
  return Array.isArray(parsed) ? parsed : [];
};

const writeLocalArray = (key, value) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore local storage errors
  }
};

const normalizeQuantity = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
};

const normalizeCount = (value) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : 0;
};

const compareText = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");

const splitCodeText = (value) =>
  String(value || "")
    .split(/[\n\r,，;；\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

const uniqueCodes = (codes) => {
  const seen = new Set();
  const output = [];
  (Array.isArray(codes) ? codes : []).forEach((code) => {
    if (seen.has(code)) {
      return;
    }
    seen.add(code);
    output.push(code);
  });
  return output;
};

const buildGeneratedSampleCodes = (taskCode, count, occupiedCodes = new Set()) => {
  const safeTaskCode = String(taskCode || "").trim();
  const targetCount = normalizeCount(count);
  if (!safeTaskCode || targetCount <= 0) {
    return [];
  }
  const output = [];
  let index = 1;
  while (output.length < targetCount) {
    const nextCode = `${safeTaskCode}-SP-${String(index).padStart(3, "0")}`;
    if (!occupiedCodes.has(nextCode)) {
      output.push(nextCode);
      occupiedCodes.add(nextCode);
    }
    index += 1;
    if (index > 9999) {
      break;
    }
  }
  return output;
};

const readStorageSnapshot = async () => {
  let tasks = readLocalArray(STORAGE_KEYS.tasks);
  let samples = readLocalArray(STORAGE_KEYS.samples);
  let schedules = readLocalArray(STORAGE_KEYS.schedules);

  try {
    const response = await fetch("/api/storage", { headers: { Accept: "application/json" } });
    if (response.ok) {
      const payload = await response.json();
      if (Array.isArray(payload?.[STORAGE_KEYS.tasks])) {
        tasks = payload[STORAGE_KEYS.tasks];
      }
      if (Array.isArray(payload?.[STORAGE_KEYS.samples])) {
        samples = payload[STORAGE_KEYS.samples];
      }
      if (Array.isArray(payload?.[STORAGE_KEYS.schedules])) {
        schedules = payload[STORAGE_KEYS.schedules];
      }
    }
  } catch {
    // fallback to local data
  }

  return { tasks, samples, schedules };
};

const persistStorage = async (updates) => {
  const payload = updates && typeof updates === "object" ? updates : {};
  Object.entries(payload).forEach(([key, value]) => {
    writeLocalArray(key, value);
  });
  try {
    await fetch("/api/storage", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // keep local fallback on write failure
  }
};

const buildRows = (tasks, samples, schedules) => {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const sampleList = Array.isArray(samples) ? samples : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];
  const taskMap = new Map();

  taskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    taskMap.set(code, {
      taskCode: code,
      taskType: String(task?.test_type || task?.name || "").trim(),
      taskStatus: String(task?.status || "").trim(),
      plannedCount: Number.isFinite(Number(task?.sample_count)) ? Number(task.sample_count) : "",
      timeValue: String(task?.created_at || task?.arrival_at || task?.due_at || "").trim(),
      sampleCodes: [],
      trays: [],
      scheduleCount: 0,
    });
  });

  sampleList.forEach((sample) => {
    const taskCode = String(sample?.task_code || "").trim();
    const sampleCode = String(sample?.code || "").trim();
    if (!taskCode || !sampleCode) {
      return;
    }
    if (!taskMap.has(taskCode)) {
      taskMap.set(taskCode, {
        taskCode,
        taskType: "",
        taskStatus: "",
        plannedCount: "",
        timeValue: "",
        sampleCodes: [],
        trays: [],
        scheduleCount: 0,
      });
    }
    const row = taskMap.get(taskCode);
    row.sampleCodes.push(sampleCode);
    if (Array.isArray(sample?.trays)) {
      sample.trays.forEach((tray) => {
        const trayCode = String(tray?.tray_code || "").trim();
        if (!trayCode) {
          return;
        }
        row.trays.push({
          trayCode,
          sampleCode,
          quantity: normalizeQuantity(tray?.quantity),
        });
      });
    }
  });

  scheduleList.forEach((entry) => {
    const taskCode = String(entry?.task_code || "").trim();
    if (!taskCode) {
      return;
    }
    if (!taskMap.has(taskCode)) {
      taskMap.set(taskCode, {
        taskCode,
        taskType: "",
        taskStatus: "",
        plannedCount: "",
        timeValue: String(entry?.start_at || entry?.created_at || "").trim(),
        sampleCodes: [],
        trays: [],
        scheduleCount: 0,
      });
    }
    const row = taskMap.get(taskCode);
    row.scheduleCount += 1;
    if (!row.taskStatus) {
      row.taskStatus = String(entry?.status || "").trim();
    }
    if (!row.timeValue) {
      row.timeValue = String(entry?.start_at || entry?.created_at || "").trim();
    }
  });

  const output = Array.from(taskMap.values()).map((row) => {
    const uniqueSampleCodes = Array.from(new Set(row.sampleCodes)).sort(compareText);
    const trayMap = new Map();
    row.trays.forEach((tray) => {
      if (!trayMap.has(tray.trayCode)) {
        trayMap.set(tray.trayCode, {
          trayCode: tray.trayCode,
          sampleCodes: [],
          totalQuantity: 0,
        });
      }
      const current = trayMap.get(tray.trayCode);
      if (!current.sampleCodes.includes(tray.sampleCode)) {
        current.sampleCodes.push(tray.sampleCode);
      }
      current.totalQuantity += normalizeQuantity(tray.quantity);
    });

    const trays = Array.from(trayMap.values())
      .map((item) => ({
        ...item,
        sampleCodes: item.sampleCodes.slice().sort(compareText),
      }))
      .sort((left, right) => compareText(left.trayCode, right.trayCode));

    const scheduleLabel = row.scheduleCount > 0 ? "已排期" : "未排期";
    const currentStatus = row.taskStatus || scheduleLabel;

    return {
      ...row,
      currentStatus,
      scheduleLabel,
      sampleCodes: uniqueSampleCodes,
      sampleCount: uniqueSampleCodes.length,
      trays,
    };
  });

  return output.sort((left, right) => compareText(left.taskCode, right.taskCode));
};

const loadOverview = async () => {
  loading.value = true;
  try {
    const { tasks, samples, schedules } = await readStorageSnapshot();
    rows.value = buildRows(tasks, samples, schedules);
  } finally {
    loading.value = false;
  }
};

const isEditing = (taskCode) => editingTaskCode.value === String(taskCode || "").trim();

const openEdit = (row) => {
  const code = String(row?.taskCode || "").trim();
  if (!code) {
    return;
  }
  if (isEditing(code)) {
    editingTaskCode.value = "";
    editError.value = "";
    editMessage.value = "";
    return;
  }
  editingTaskCode.value = code;
  editError.value = "";
  editMessage.value = "";
  editForm.value = {
    taskCode: code,
    taskType: String(row?.taskType || "").trim(),
    sampleCount: normalizeCount(row?.sampleCount),
    sampleCodesText: (Array.isArray(row?.sampleCodes) ? row.sampleCodes : []).join("\n"),
  };
};

const cancelEdit = () => {
  editingTaskCode.value = "";
  editError.value = "";
  editMessage.value = "";
};

const generateCodesByCount = () => {
  const taskCode = String(editForm.value.taskCode || "").trim();
  const count = normalizeCount(editForm.value.sampleCount);
  if (!taskCode) {
    editError.value = "缺少任务编号，无法生成样品编号。";
    return;
  }
  editError.value = "";
  editMessage.value = "";
  const generated = buildGeneratedSampleCodes(taskCode, count, new Set());
  editForm.value.sampleCodesText = generated.join("\n");
};

const saveEdit = async (taskCode) => {
  const code = String(taskCode || editForm.value.taskCode || "").trim();
  if (!code || savingTaskCode.value) {
    return;
  }
  const nextTaskType = String(editForm.value.taskType || "").trim();
  if (!nextTaskType) {
    editError.value = "任务类型不能为空。";
    editMessage.value = "";
    return;
  }

  savingTaskCode.value = code;
  editError.value = "";
  editMessage.value = "";

  try {
    const { tasks, samples, schedules } = await readStorageSnapshot();
    const taskIndex = tasks.findIndex((task) => String(task?.code || "").trim() === code);
    if (taskIndex < 0) {
      editError.value = `未找到任务 ${code}。`;
      return;
    }

    const inputCodes = uniqueCodes(splitCodeText(editForm.value.sampleCodesText));
    let desiredCount = normalizeCount(editForm.value.sampleCount);
    if (desiredCount <= 0) {
      desiredCount = inputCodes.length;
    }

    let finalCodes = inputCodes.slice(0, desiredCount || inputCodes.length);
    if (desiredCount > finalCodes.length) {
      const occupied = new Set(finalCodes);
      const generated = buildGeneratedSampleCodes(code, desiredCount - finalCodes.length, occupied);
      finalCodes = finalCodes.concat(generated);
    }
    finalCodes = uniqueCodes(finalCodes);
    if (desiredCount > finalCodes.length) {
      const generated = buildGeneratedSampleCodes(code, desiredCount - finalCodes.length, new Set(finalCodes));
      finalCodes = finalCodes.concat(generated);
    }

    const otherTaskCodeSet = new Set(
      samples
        .filter((sample) => String(sample?.task_code || "").trim() !== code)
        .map((sample) => String(sample?.code || "").trim())
        .filter(Boolean)
    );
    const duplicateWithOthers = finalCodes.filter((sampleCode) => otherTaskCodeSet.has(sampleCode));
    if (duplicateWithOthers.length > 0) {
      editError.value = `样品编号已被其他任务占用：${duplicateWithOthers.join("、")}`;
      return;
    }

    const now = new Date().toISOString();
    const taskSamples = samples
      .filter((sample) => String(sample?.task_code || "").trim() === code)
      .sort((left, right) => compareText(left?.code, right?.code));

    const nextTaskSamples = finalCodes.map((sampleCode, index) => {
      const existing = taskSamples[index];
      if (existing) {
        const updated = {
          ...existing,
          code: sampleCode,
          task_code: code,
          updated_at: now,
        };
        if (Array.isArray(existing.trays)) {
          updated.trays = existing.trays.map((tray) => ({
            ...tray,
            sample_code: sampleCode,
            updated_at: now,
          }));
        }
        return updated;
      }
      return {
        id: `sample-${Date.now()}-${index}`,
        code: sampleCode,
        task_code: code,
        location: "",
        owner: "",
        status: "运输中",
        flow_status: "运输中",
        created_at: now,
      };
    });

    const nextTasks = tasks.map((task, index) => {
      if (index !== taskIndex) {
        return task;
      }
      return {
        ...task,
        test_type: nextTaskType,
        name: nextTaskType,
        required_device: nextTaskType,
        sample_count: finalCodes.length,
        updated_at: now,
      };
    });

    const nextSamples = samples
      .filter((sample) => String(sample?.task_code || "").trim() !== code)
      .concat(nextTaskSamples);

    await persistStorage({
      [STORAGE_KEYS.tasks]: nextTasks,
      [STORAGE_KEYS.samples]: nextSamples,
    });

    rows.value = buildRows(nextTasks, nextSamples, schedules);
    editForm.value.sampleCount = finalCodes.length;
    editForm.value.sampleCodesText = finalCodes.join("\n");
    editMessage.value = `任务 ${code} 已更新：任务类型、样品数量和样品编号已同步。`;
  } finally {
    savingTaskCode.value = "";
  }
};

const filteredRows = computed(() => {
  const query = keyword.value.toLowerCase();
  const selectedType = testTypeFilter.value.trim();
  const selectedTime = timeFilter.value;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ms7 = 7 * 24 * 60 * 60 * 1000;
  const ms30 = 30 * 24 * 60 * 60 * 1000;

  const matchTime = (row) => {
    if (selectedTime === "all") {
      return true;
    }
    const rowTime = new Date(row.timeValue || "").getTime();
    if (!Number.isFinite(rowTime)) {
      return false;
    }
    if (selectedTime === "today") {
      return rowTime >= startOfToday;
    }
    if (selectedTime === "last7") {
      return now.getTime() - rowTime <= ms7;
    }
    if (selectedTime === "last30") {
      return now.getTime() - rowTime <= ms30;
    }
    if (selectedTime === "thisYear") {
      return new Date(rowTime).getFullYear() === now.getFullYear();
    }
    return true;
  };

  return rows.value.filter((row) => {
    if (selectedType && (row.taskType || "") !== selectedType) {
      return false;
    }
    if (!matchTime(row)) {
      return false;
    }
    if (!query) {
      return true;
    }
    const text = [
      row.taskCode,
      row.taskType,
      row.currentStatus,
      row.scheduleLabel,
      row.sampleCodes.join(" "),
      row.trays.map((tray) => tray.trayCode).join(" "),
    ]
      .join(" ")
      .toLowerCase();
    return text.includes(query);
  });
});

const testTypeOptions = computed(() =>
  Array.from(new Set(rows.value.map((row) => String(row.taskType || "").trim()).filter(Boolean))).sort((a, b) =>
    a.localeCompare(b, "zh-Hans-CN")
  )
);

const taskTypeEditOptions = computed(() => testTypeOptions.value);

onMounted(loadOverview);
</script>
