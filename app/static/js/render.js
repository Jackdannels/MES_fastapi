/* FILE: render.js
 * UI renderers for tables, gantt view, and summary widgets.
 * Reads localStorage and paints DOM for each page.
 */
import { STORAGE_KEYS, loadStore, saveStore } from "./storage.js";
import { TEST_LABS, getLabsForTestType } from "./labs.js";
import { formatDateTime, setText, statusClass } from "./utils.js";

// Device status derived from current schedules.
function computeDeviceStatus(device, schedules, labels) {
  const now = new Date();
  const active = schedules.find((entry) => {
    if (entry.device !== device.code) {
      return false;
    }
    const start = new Date(entry.start_at);
    const end = new Date(entry.end_at);
    return start <= now && end >= now;
  });
  if (active) {
    return labels.deviceInUse;
  }
  return device.status || labels.deviceIdle;
}

function toDateTimeLocalValue(value) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.includes("T")) {
      return trimmed.slice(0, 16);
    }
    if (trimmed.includes(" ")) {
      const replaced = trimmed.replace(" ", "T");
      return replaced.slice(0, 16);
    }
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toISOString().slice(0, 16);
}

function getDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDayLabel(date) {
  try {
    const formatted = new Intl.DateTimeFormat("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).format(date);
    return formatted.replace(/\//g, "-");
  } catch {
    return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
}

function buildDayRange(totalDays) {
  const days = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < totalDays; i += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + i);
    days.push({ date, key: getDateKey(date), label: formatDayLabel(date) });
  }
  return days;
}

function clearDynamicHeaders(row) {
  if (!row) {
    return;
  }
  Array.from(row.children).forEach((child) => {
    if (!child.dataset.static) {
      child.remove();
    }
  });
}

// Gantt rendering for schedule overview.
function renderGanttSchedule(computed, devices, filterDevice = "") {
  const table = document.getElementById("gantt-table");
  const dayRow = document.getElementById("gantt-day-row");
  const slotRow = document.getElementById("gantt-slot-row");
  const body = document.getElementById("gantt-body");
  if (!table || !dayRow || !slotRow || !body) {
    return;
  }
  const deviceList = Array.isArray(devices) ? devices : [];
  const activeFilter = (filterDevice || "").trim();
  const totalDays = Math.max(1, Number.parseInt(table.dataset.days || "3", 10));
  const labelAm = table.dataset.labelAm || "AM";
  const labelPm = table.dataset.labelPm || "PM";
  const labelIdle = table.dataset.labelIdle || "Idle";
  const labelConflict = table.dataset.labelConflict || "Conflict";
  const labelEmpty = table.dataset.labelEmpty || "No devices";

  const days = buildDayRange(totalDays);
  const entries = activeFilter
    ? computed.filter((entry) => entry.device === activeFilter)
    : computed;

  clearDynamicHeaders(dayRow);
  slotRow.innerHTML = "";
  days.forEach((day) => {
    const dayCell = document.createElement("th");
    dayCell.colSpan = 2;
    dayCell.textContent = day.label;
    dayCell.dataset.dayKey = day.key;
    dayRow.appendChild(dayCell);

    const amCell = document.createElement("th");
    amCell.textContent = labelAm;
    slotRow.appendChild(amCell);

    const pmCell = document.createElement("th");
    pmCell.textContent = labelPm;
    slotRow.appendChild(pmCell);
  });

  const deviceRows = [];
  if (activeFilter) {
    deviceRows.push({ code: activeFilter });
  } else {
    const seen = new Set();
    const pushDevice = (code) => {
      const value = code || "";
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      deviceRows.push({ code: value });
    };
    TEST_LABS.forEach((lab) => pushDevice(lab));
    deviceList.forEach((device) => pushDevice(device.code || device.name || ""));
    Array.from(new Set(computed.map((entry) => entry.device).filter(Boolean))).forEach((code) => pushDevice(code));
  }

  body.innerHTML = "";
  if (deviceRows.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = days.length * 2 + 1;
    cell.className = "muted";
    cell.textContent = labelEmpty;
    row.appendChild(cell);
    body.appendChild(row);
    return;
  }

  const slotsByDevice = {};
  deviceRows.forEach((device) => {
    slotsByDevice[device.code] = {};
    days.forEach((day) => {
      slotsByDevice[device.code][day.key] = { am: [], pm: [] };
    });
  });

  const overlaps = (start, end, rangeStart, rangeEnd) => start < rangeEnd && end > rangeStart;

  entries.forEach((entry) => {
    if (!entry.device || !entry.start_at || !entry.end_at) {
      return;
    }
    const start = new Date(entry.start_at);
    const end = new Date(entry.end_at);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return;
    }
    if (!slotsByDevice[entry.device]) {
      slotsByDevice[entry.device] = {};
      days.forEach((day) => {
        slotsByDevice[entry.device][day.key] = { am: [], pm: [] };
      });
    }

    days.forEach((day) => {
      const dayStart = new Date(day.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayStart.getDate() + 1);
      const morningStart = new Date(dayStart);
      morningStart.setHours(8, 0, 0, 0);
      const morningEnd = new Date(dayStart);
      morningEnd.setHours(11, 30, 0, 0);
      const afternoonStart = new Date(dayStart);
      afternoonStart.setHours(13, 30, 0, 0);
      const afternoonEnd = new Date(dayStart);
      afternoonEnd.setHours(17, 0, 0, 0);

      let assigned = false;
      if (overlaps(start, end, morningStart, morningEnd)) {
        slotsByDevice[entry.device][day.key].am.push(entry);
        assigned = true;
      }
      if (overlaps(start, end, afternoonStart, afternoonEnd)) {
        slotsByDevice[entry.device][day.key].pm.push(entry);
        assigned = true;
      }
      if (!assigned && overlaps(start, end, dayStart, dayEnd)) {
        const midpoint = new Date((start.getTime() + end.getTime()) / 2);
        if (midpoint < afternoonStart) {
          slotsByDevice[entry.device][day.key].am.push(entry);
        } else {
          slotsByDevice[entry.device][day.key].pm.push(entry);
        }
      }
    });
  });

  deviceRows.forEach((device) => {
    const row = document.createElement("tr");
    const labelCell = document.createElement("td");
    labelCell.className = "gantt-sticky";
    labelCell.textContent = device.code;
    row.appendChild(labelCell);

    days.forEach((day) => {
      ["am", "pm"].forEach((segment) => {
        const td = document.createElement("td");
        const slot = document.createElement("div");
        slot.className = "gantt-slot";
        slot.dataset.device = device.code;
        slot.dataset.date = day.key;
        slot.dataset.segment = segment;
        if (segment === "am") {
          slot.dataset.start = "08:00";
          slot.dataset.end = "11:30";
        } else {
          slot.dataset.start = "13:30";
          slot.dataset.end = "17:00";
        }
        const entries = slotsByDevice[device.code]?.[day.key]?.[segment] || [];
        if (entries.length === 0) {
          slot.classList.add("idle");
          slot.textContent = labelIdle;
          slot.title = labelIdle;
        } else if (entries.length === 1) {
          slot.classList.add("busy");
          if (entries[0].id) {
            slot.dataset.scheduleId = entries[0].id;
          }
          slot.textContent = entries[0].task_code || entries[0].device || "";
          slot.title = `${entries[0].task_code || ""} ${formatDateTime(entries[0].start_at)}-${formatDateTime(
            entries[0].end_at
          )} ${entries[0].status || ""}`.trim();
        } else {
          slot.classList.add("conflict");
          if (entries[0].id) {
            slot.dataset.scheduleId = entries[0].id;
          }
          const label = document.createElement("div");
          label.className = "gantt-conflict-label";
          label.textContent = `${entries[0].task_code || entries[0].device || ""} +${entries.length - 1}`;
          const select = document.createElement("select");
          select.className = "gantt-conflict-select";
          const placeholder = document.createElement("option");
          placeholder.value = "";
          placeholder.textContent = "选择冲突任务";
          select.appendChild(placeholder);
          entries.forEach((entry) => {
            if (!entry.id) {
              return;
            }
            const option = document.createElement("option");
            option.value = entry.id;
            option.textContent = entry.task_code || entry.device || entry.id;
            select.appendChild(option);
          });
          slot.appendChild(label);
          slot.appendChild(select);
          slot.title = entries
            .map(
              (item) =>
                `${item.task_code || ""} ${formatDateTime(item.start_at)}-${formatDateTime(item.end_at)} ${
                  item.status || ""
                }`.trim()
            )
            .join("\n");
          if (!slot.title) {
            slot.title = labelConflict;
          }
        }
        td.appendChild(slot);
        row.appendChild(td);
      });
    });

    body.appendChild(row);
  });
}

function renderTasksPage(labels) {
  const tbody = document.getElementById("task-table-body");
  if (!tbody) {
    return;
  }
  const pagination = document.getElementById("task-list-pagination");
  let tasks = loadStore(STORAGE_KEYS.tasks, []);
  let schedules = loadStore(STORAGE_KEYS.schedules, []);
  if (!Array.isArray(tasks)) {
    tasks = [];
  }
  if (!Array.isArray(schedules)) {
    schedules = [];
  }
  let normalizedStatusUpdated = false;
  tasks.forEach((task) => {
    if (!task?.status) {
      return;
    }
    if (task.status === "已受理" || task.status === labels.statusAccepted) {
      task.status = labels.statusWaiting;
      normalizedStatusUpdated = true;
    }
  });
  const externalCount = tasks.filter((t) => t.source === labels.sourceExternal).length;
  const internalCount = tasks.filter((t) => t.source === labels.sourceInternal).length;

  const now = new Date();
  const retentionStatus = labels.statusRetention || "暂存间排放";
  const runningStatus = labels.statusExperimenting || labels.statusRunning || "实验中";
  const completedStatus = labels.statusCompleted || "实验已经完成";
  const scheduledStatus = labels.statusScheduled || "已排程";
  const schedulesByTask = new Map();
  let taskStatusUpdated = normalizedStatusUpdated;
  schedules.forEach((entry) => {
    if (!entry?.task_code) {
      return;
    }
    if (!schedulesByTask.has(entry.task_code)) {
      schedulesByTask.set(entry.task_code, []);
    }
    schedulesByTask.get(entry.task_code).push(entry);
  });
  const resolveTaskStatus = (task) => {
    const entries = schedulesByTask.get(task.code) || [];
    if (!entries.length) {
      return task.status || "";
    }
    const labEntries = entries.filter((entry) => entry.device !== labels.retentionLocation);
    const retentionEntries = entries.filter((entry) => entry.device === labels.retentionLocation);
    if (!labEntries.length && retentionEntries.length) {
      return retentionStatus;
    }
    if (!labEntries.length) {
      return task.status || scheduledStatus;
    }
    const validEntries = labEntries.filter((entry) => {
      const start = new Date(entry.start_at);
      const end = new Date(entry.end_at);
      return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime());
    });
    if (!validEntries.length) {
      return scheduledStatus;
    }
    const hasActive = validEntries.some((entry) => {
      const start = new Date(entry.start_at);
      const end = new Date(entry.end_at);
      return start <= now && end >= now;
    });
    if (hasActive) {
      return runningStatus;
    }
    const allEnded = validEntries.every((entry) => new Date(entry.end_at) < now);
    if (allEnded) {
      return completedStatus;
    }
    return scheduledStatus;
  };

  let waitingCount = 0;
  let retentionCount = 0;
  const rows = [];
  tasks.forEach((task) => {
    const displayStatus = resolveTaskStatus(task);
    const effectiveStatus = displayStatus || task.status || "";
    if (displayStatus && displayStatus !== task.status) {
      task.status = displayStatus;
      taskStatusUpdated = true;
    }
    if (effectiveStatus === labels.statusRetention) {
      retentionCount += 1;
    }
    if (effectiveStatus === labels.statusWaiting || effectiveStatus === labels.statusAccepted) {
      waitingCount += 1;
    }
    rows.push({ task, displayStatus });
  });

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  let currentPage = pagination ? Number.parseInt(pagination.dataset.page || "1", 10) : 1;
  if (!Number.isFinite(currentPage) || currentPage < 1) {
    currentPage = 1;
  }
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
  if (pagination) {
    pagination.dataset.page = String(currentPage);
    pagination.dataset.total = String(totalPages);
  }

  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = rows.slice(startIndex, startIndex + pageSize);

  tbody.innerHTML = "";
  pageItems.forEach(({ task, displayStatus }) => {
    const row = document.createElement("tr");
    if (task.id) {
      row.dataset.taskId = task.id;
    }
    if (task.code) {
      row.dataset.taskCode = task.code;
    }
    row.innerHTML = `
      <td>${task.code || ""}</td>
      <td>${task.source || ""}</td>
      <td>${task.sample_count || ""}</td>
      <td>${task.test_type || ""}</td>
      <td><span class="pill">${task.required_device || "-"}</span></td>
      <td>${formatDateTime(task.due_at)}</td>
      <td><span class="${statusClass(displayStatus, labels)}">${displayStatus || ""}</span></td>
      <td><button type="button" class="action-link" data-action="task-edit" data-drawer-open="task-drawer" data-task-id="${
        task.id || ""
      }" data-task-code="${task.code || ""}">${labels.edit}</button></td>
    `;
    tbody.appendChild(row);
  });
  const unscheduledCount = waitingCount + retentionCount;
  setText("task-external-count", externalCount);
  setText("task-internal-count", internalCount);
  setText("task-unscheduled-count", `${unscheduledCount}（暂存间存放${retentionCount}）`);
  if (taskStatusUpdated) {
    saveStore(STORAGE_KEYS.tasks, tasks);
  }
  if (pagination) {
    const appendEllipsis = () => {
      const span = document.createElement("span");
      span.className = "page-ellipsis";
      span.textContent = "...";
      pagination.appendChild(span);
    };
    const appendPage = (page) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `page-btn${page === currentPage ? " active" : ""}`;
      btn.textContent = String(page);
      btn.dataset.page = String(page);
      pagination.appendChild(btn);
    };
    const appendNav = (label, action, disabled) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "page-btn nav";
      btn.textContent = label;
      btn.dataset.page = action;
      btn.disabled = disabled;
      pagination.appendChild(btn);
    };

    pagination.innerHTML = "";
    if (totalPages <= 1) {
      pagination.classList.add("is-hidden");
    } else {
      pagination.classList.remove("is-hidden");
      appendNav("上一页", "prev", currentPage <= 1);

      if (totalPages <= 5) {
        for (let i = 1; i <= totalPages; i += 1) {
          appendPage(i);
        }
      } else if (currentPage <= 3) {
        [1, 2, 3, 4].forEach((page) => appendPage(page));
        appendEllipsis();
        appendPage(totalPages);
      } else if (currentPage >= totalPages - 2) {
        appendPage(1);
        appendEllipsis();
        [totalPages - 3, totalPages - 2, totalPages - 1, totalPages].forEach((page) => appendPage(page));
      } else {
        appendPage(1);
        appendEllipsis();
        [currentPage - 1, currentPage, currentPage + 1].forEach((page) => appendPage(page));
        appendEllipsis();
        appendPage(totalPages);
      }

      appendNav("下一页", "next", currentPage >= totalPages);

      if (pagination.dataset.bound !== "1") {
        pagination.addEventListener("click", (event) => {
          const target = event.target.closest(".page-btn");
          if (!target || target.disabled) {
            return;
          }
          const action = target.dataset.page || "";
          const total = Number.parseInt(pagination.dataset.total || "1", 10);
          let current = Number.parseInt(pagination.dataset.page || "1", 10);
          if (!Number.isFinite(current) || current < 1) {
            current = 1;
          }
          const maxPage = Number.isFinite(total) && total > 0 ? total : 1;
          let nextPage = current;
          if (action === "prev") {
            nextPage = Math.max(1, current - 1);
          } else if (action === "next") {
            nextPage = Math.min(maxPage, current + 1);
          } else {
            const parsed = Number.parseInt(action, 10);
            if (Number.isFinite(parsed)) {
              nextPage = parsed;
            }
          }
          if (nextPage === current) {
            return;
          }
          pagination.dataset.page = String(nextPage);
          renderTasksPage(labels);
        });
        pagination.dataset.bound = "1";
      }
    }
  }
  renderTaskQuickSelect(tasks);
}

function renderTaskQuickSelect(tasks) {
  const form = document.querySelector('[data-form="task-quick"]');
  if (!form) {
    return;
  }
  const select = form.querySelector("select[data-task-quick-select]");
  if (!select) {
    return;
  }
  const nameInput = form.querySelector('input[name="name"]');
  const sourceSelect = form.querySelector('select[name="source"]');
  const prioritySelect = form.querySelector('select[name="priority"]');
  const dueInput = form.querySelector('input[name="due_at"]');
  const placeholderText = select.dataset.placeholder || "Select task";
  const emptyText = select.dataset.emptyPlaceholder || "No tasks";
  const previousValue = select.value;

  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = tasks.length ? placeholderText : emptyText;
  select.appendChild(placeholder);

  tasks.forEach((task) => {
    if (!task.code) {
      return;
    }
    const option = document.createElement("option");
    option.value = task.code;
    option.textContent = `${task.code}${task.name ? ` ${task.name}` : ""}`.trim();
    option.dataset.name = task.name || "";
    option.dataset.source = task.source || "";
    option.dataset.priority = task.priority || "";
    option.dataset.dueAt = task.due_at || "";
    select.appendChild(option);
  });

  if (previousValue && tasks.some((task) => task.code === previousValue)) {
    select.value = previousValue;
  }

  if (!select.dataset.bound) {
    select.addEventListener("change", () => {
      const option = select.options[select.selectedIndex];
      if (!option || !option.value) {
        return;
      }
      if (nameInput) {
        nameInput.value = option.dataset.name || nameInput.value;
      }
      if (sourceSelect && option.dataset.source) {
        sourceSelect.value = option.dataset.source;
      }
      if (prioritySelect && option.dataset.priority) {
        prioritySelect.value = option.dataset.priority;
      }
      if (dueInput && option.dataset.dueAt) {
        dueInput.value = toDateTimeLocalValue(option.dataset.dueAt);
      }
    });
    select.dataset.bound = "1";
  }
}

function buildSampleEvents(sample) {
  if (Array.isArray(sample.history) && sample.history.length) {
    return sample.history;
  }
  return [
    {
      time: sample.created_at || "",
      action: "样品登记",
      location: sample.location || "",
      owner: sample.owner || "",
      status: sample.status || "",
      detail: "",
    },
  ];
}

function renderStagingSamples(labels, samples) {
  const body = document.getElementById("staging-table-body");
  if (!body) {
    return;
  }
  const stagingSamples = samples.filter(
    (sample) => sample.location === labels.retentionLocation && sample.status !== labels.sampleTesting
  );
  setText("staging-count", stagingSamples.length);
  body.innerHTML = "";
  stagingSamples.forEach((sample) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${sample.code || ""}</td>
      <td>${sample.task_code || ""}</td>
      <td>${sample.location || ""}</td>
      <td><span class="${statusClass(sample.status, labels)}">${sample.status || ""}</span></td>
      <td>${sample.owner || ""}</td>
    `;
    body.appendChild(row);
  });
}

function renderSampleTrace(labels, taskCode) {
  const summaryEl = document.getElementById("sample-trace-summary");
  const timeline = document.getElementById("sample-trace-timeline");
  if (!summaryEl || !timeline) {
    return;
  }
  const trimmed = (taskCode || "").trim();
  if (!trimmed) {
    summaryEl.textContent = "请输入试验序号查询样品全生命周期。";
    timeline.innerHTML = "";
    return;
  }
  const samples = loadStore(STORAGE_KEYS.samples, []);
  const schedules = loadStore(STORAGE_KEYS.schedules, []);
  const matches = samples.filter((sample) => sample.task_code === trimmed);
  const scheduleMatches = schedules.filter((entry) => entry.task_code === trimmed);

  const events = [];
  matches.forEach((sample) => {
    buildSampleEvents(sample).forEach((event) => {
      events.push({ ...event, sample_code: sample.code || "" });
    });
  });
  scheduleMatches.forEach((entry) => {
    if (entry.start_at) {
      events.push({
        time: entry.start_at,
        action: "排程开始",
        location: entry.device || "",
        status: entry.status || labels.statusScheduled,
        detail: "",
      });
    }
    if (entry.end_at) {
      events.push({
        time: entry.end_at,
        action: "排程结束",
        location: entry.device || "",
        status: entry.status || labels.statusScheduled,
        detail: "",
      });
    }
  });

  if (events.length === 0) {
    summaryEl.textContent = `未找到试验序号 ${trimmed} 的样品记录。`;
    timeline.innerHTML = "";
    return;
  }

  summaryEl.textContent = `试验序号 ${trimmed}：样品 ${matches.length} 个，流转记录 ${events.length} 条。`;
  const timeValue = (value) => {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? Number.MAX_SAFE_INTEGER : time;
  };
  events.sort((a, b) => timeValue(a.time) - timeValue(b.time));

  timeline.innerHTML = "";
  events.forEach((event) => {
    const item = document.createElement("div");
    item.className = "timeline-item";
    const titleParts = [];
    if (event.sample_code) {
      titleParts.push(event.sample_code);
    } else if (trimmed) {
      titleParts.push(trimmed);
    }
    titleParts.push(event.action || "样品流转");
    const detailParts = [];
    if (event.time) {
      detailParts.push(formatDateTime(event.time));
    }
    if (event.location) {
      detailParts.push(event.location);
    }
    if (event.owner) {
      detailParts.push(`责任人：${event.owner}`);
    }
    if (event.status) {
      detailParts.push(event.status);
    }
    if (event.detail) {
      detailParts.push(event.detail);
    }
    item.innerHTML = `
      <div class="timeline-dot"></div>
      <div>
        <div>${titleParts.join(" · ")}</div>
        <div class="muted">${detailParts.join(" | ")}</div>
      </div>
    `;
    timeline.appendChild(item);
  });
}



function renderUnpackingSchedule(labels, samples) {
  const body = document.getElementById("unpacking-table-body");
  if (!body) {
    return;
  }
  const intakeLocations = [labels.intakeLocation, labels.unpackingLocation].filter(Boolean);
  const unpackingSamples = samples.filter((sample) => intakeLocations.includes(sample.location));
  setText("unpacking-count", unpackingSamples.length);
  body.innerHTML = "";
  unpackingSamples.forEach((sample) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${sample.code || ""}</td>
      <td>${sample.task_code || ""}</td>
      <td>${sample.location || ""}</td>
      <td><span class="${statusClass(sample.status, labels)}">${sample.status || ""}</span></td>
      <td>${sample.owner || ""}</td>
    `;
    body.appendChild(row);
  });
}

// Retention filter helpers for intake -> retention flow.
const RETENTION_DISPATCH_ACTIONS = [
  "\u63a5\u9a73\u533a\u9001\u8fbe\u6682\u5b58\u95f4",
  "\u62c6\u7bb1\u64cd\u4f5c\u95f4\u9001\u8fbe\u6682\u5b58\u95f4",
];

const RETENTION_EXCLUDE_CODES = new Set(["CJ-2024-001", "GDW-2024-005"]);
const RETENTION_EXCLUDE_NAME = /\u6279\u6b21A|\u6279\u6b21E/;
const RETENTION_AGE_INTERVAL_MIN = 4;
const RETENTION_AGE_CLASSES = ["level-0", "level-1", "level-2", "level-3"];
let retentionAgeTimer = null;


function isRetentionExcludedTask(task) {
  if (!task) {
    return false;
  }
  if (RETENTION_EXCLUDE_CODES.has(task.code)) {
    return true;
  }
  const name = task.name || "";
  return RETENTION_EXCLUDE_NAME.test(name);
}
function isRetentionFromIntake(sample, labels) {
  if (sample.retention_source) {
    return sample.retention_source === "intake";
  }
  if (labels?.retentionLocation && sample.location === labels.retentionLocation) {
    return true;
  }
  if (Array.isArray(sample.history)) {
    return sample.history.some((event) => {
      const action = typeof event?.action === "string" ? event.action : "";
      return RETENTION_DISPATCH_ACTIONS.some((item) => action.includes(item));
    });
  }
  return false;
}

function getRetentionEntryTime(sample) {
  if (!sample) {
    return null;
  }
  const history = Array.isArray(sample.history) ? sample.history : [];
  const entry = history.find((event) => {
    const action = typeof event?.action === "string" ? event.action : "";
    return action.includes("\u9001\u8fbe\u6682\u5b58\u95f4");
  });
  const raw = entry?.time || sample.updated_at || sample.created_at || "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function getRetentionAgeLevel(minutes) {
  if (!Number.isFinite(minutes) || minutes < 0) {
    return 0;
  }
  const steps = Math.floor(minutes / RETENTION_AGE_INTERVAL_MIN);
  return steps % RETENTION_AGE_CLASSES.length;
}

function updateRetentionAgeBadges(root) {
  const container = root || document;
  const now = Date.now();
  container.querySelectorAll("[data-retention-since]").forEach((badge) => {
    const sinceValue = badge.getAttribute("data-retention-since");
    const since = new Date(sinceValue);
    if (Number.isNaN(since.getTime())) {
      return;
    }
    const minutes = Math.max(0, Math.floor((now - since.getTime()) / 60000));
    badge.textContent = `${minutes} \u5206\u949f`;
    const level = getRetentionAgeLevel(minutes);
    RETENTION_AGE_CLASSES.forEach((cls, idx) => {
      badge.classList.toggle(cls, idx === level);
    });
  });
}

function ensureRetentionAgeTimer() {
  if (retentionAgeTimer) {
    return;
  }
  retentionAgeTimer = window.setInterval(() => {
    updateRetentionAgeBadges(document);
  }, 60 * 1000);
}

function renderRetentionSchedule(labels, samples) {
  const body = document.getElementById("retention-schedule-table-body");
  if (!body) {
    return;
  }
  const retentionSamples = samples.filter(
    (sample) =>
      sample.location === labels.retentionLocation &&
      sample.status !== labels.sampleTesting &&
      isRetentionFromIntake(sample, labels)
  );
  setText("retention-schedule-count", retentionSamples.length);
  body.innerHTML = "";
  retentionSamples.forEach((sample) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${sample.code || ""}</td>
      <td>${sample.task_code || ""}</td>
      <td>${sample.location || ""}</td>
      <td><span class="${statusClass(sample.status, labels)}">${sample.status || ""}</span></td>
      <td>${sample.owner || ""}</td>
    `;
    body.appendChild(row);
  });
}

function renderRetentionInternalSchedule(labels) {
  const section = document.querySelector("[data-retention-internal]");
  const body = document.getElementById("retention-internal-table-body");
  if (!section || !body) {
    return;
  }

  const tabGroup = document.querySelector('[data-tab-group="schedule-board"][data-tab-role="tabs"]');
  const activeTab = tabGroup?.querySelector(".tab-btn.active")?.getAttribute("data-tab-btn");
  const retentionActive = activeTab === "retention";
  section.classList.toggle("is-hidden", !retentionActive);
  if (!retentionActive) {
    return;
  }

  let tasks = loadStore(STORAGE_KEYS.tasks, []);
  let samples = loadStore(STORAGE_KEYS.samples, []);
  let schedules = loadStore(STORAGE_KEYS.schedules, []);
  if (!Array.isArray(tasks)) {
    tasks = [];
  }
  if (!Array.isArray(samples)) {
    samples = [];
  }
  if (!Array.isArray(schedules)) {
    schedules = [];
  }

  const taskByCode = new Map();
  tasks.forEach((task) => {
    if (task?.code) {
      taskByCode.set(task.code, task);
    }
  });

  const scheduledToLab = new Set(
    schedules
      .filter((entry) => entry?.task_code && entry?.device && entry.device !== labels.retentionLocation)
      .map((entry) => entry.task_code)
  );
  const retentionSchedules = schedules.filter(
    (entry) => entry?.task_code && entry?.device === labels.retentionLocation
  );

  const retentionTasks = new Map();
  const retentionSamples = samples.filter(
    (sample) =>
      sample.location === labels.retentionLocation &&
      sample.status !== labels.sampleTesting &&
      isRetentionFromIntake(sample, labels)
  );

  retentionSamples.forEach((sample) => {
    const code = sample.task_code || "";
    if (!code || scheduledToLab.has(code)) {
      return;
    }
    const task = taskByCode.get(code);
    if (task && isRetentionExcludedTask(task)) {
      return;
    }
    const since = getRetentionEntryTime(sample);
    const current =
      retentionTasks.get(code) || { code, name: task?.name || "", testType: task?.test_type || "", since: null };
    if (since && (!current.since || since < current.since)) {
      current.since = since;
    }
    if (!current.name && task?.name) {
      current.name = task.name;
    }
    if (!current.testType && task?.test_type) {
      current.testType = task.test_type;
    }
    retentionTasks.set(code, current);
  });

  retentionSchedules.forEach((entry) => {
    const code = entry.task_code || "";
    if (!code || scheduledToLab.has(code)) {
      return;
    }
    const task = taskByCode.get(code);
    if (task && isRetentionExcludedTask(task)) {
      return;
    }
    const since = entry.start_at ? new Date(entry.start_at) : null;
    const validSince = since && !Number.isNaN(since.getTime()) ? since : null;
    const current =
      retentionTasks.get(code) || { code, name: task?.name || "", testType: task?.test_type || "", since: null };
    if (validSince && (!current.since || validSince < current.since)) {
      current.since = validSince;
    }
    if (!current.name && task?.name) {
      current.name = task.name;
    }
    if (!current.testType && task?.test_type) {
      current.testType = task.test_type;
    }
    retentionTasks.set(code, current);
  });

  const list = Array.from(retentionTasks.values());
  list.sort((a, b) => {
    const aTime = a.since ? a.since.getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.since ? b.since.getTime() : Number.MAX_SAFE_INTEGER;
    return aTime - bTime;
  });

  setText("retention-internal-count", list.length);
  body.innerHTML = "";
  if (list.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td class="muted" colspan="4">\u6682\u65e0\u6682\u5b58\u95f4\u5f85\u5206\u914d\u4efb\u52a1</td>`;
    body.appendChild(row);
    return;
  }

  list.forEach((item) => {
    const row = document.createElement("tr");
    const sinceText = item.since ? formatDateTime(item.since) : "-";
    row.innerHTML = `
      <td>${item.code}</td>
      <td>${item.testType || ""}</td>
      <td>${sinceText}</td>
    `;
    const waitCell = document.createElement("td");
    if (item.since) {
      const badge = document.createElement("span");
      badge.className = "retention-age";
      badge.setAttribute("data-retention-since", item.since.toISOString());
      waitCell.appendChild(badge);
    } else {
      waitCell.textContent = "--";
    }
    row.appendChild(waitCell);
    body.appendChild(row);
  });
  updateRetentionAgeBadges(body);
  ensureRetentionAgeTimer();
}

function isReceivedTask(task, labels) {
  if (!task) {
    return false;
  }
  const status = (task.status || "").trim();
  if (!status) {
    return false;
  }
  if (labels?.statusCompleted && status === labels.statusCompleted) {
    return false;
  }
  const receivedStatuses = new Set(
    [
      labels?.statusAccepted,
      labels?.statusWaiting,
      labels?.statusScheduled,
      labels?.statusRunning,
      labels?.statusExperimenting,
      labels?.statusRetention,
      "已受理",
      "待排程",
      "已排程",
      "实验中",
      "暂存间排放",
      "暂存间存放",
    ].filter(Boolean)
  );
  return receivedStatuses.has(status);
}

function buildSampleTaskList(tasks, samples, schedules) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const list = [];
  const byCode = new Map();
  taskList.forEach((task) => {
    if (!task?.code) {
      return;
    }
    byCode.set(task.code, task);
    list.push(task);
  });
  const appendMissing = (code) => {
    const value = (code || "").trim();
    if (!value || byCode.has(value)) {
      return;
    }
    const placeholder = { code: value, name: "", sample_count: "" };
    byCode.set(value, placeholder);
    list.push(placeholder);
  };
  (Array.isArray(samples) ? samples : []).forEach((sample) => appendMissing(sample.task_code));
  (Array.isArray(schedules) ? schedules : []).forEach((entry) => appendMissing(entry.task_code));
  return list;
}

function fillSampleTaskSelects(taskList) {
  const tasks = Array.isArray(taskList) ? taskList : [];
  document.querySelectorAll("select[data-sample-task-select]").forEach((select) => {
    const previousValue = select.value;
    const placeholderText = select.dataset.placeholder || "Select task";
    const emptyText = select.dataset.emptyPlaceholder || "No tasks";

    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = tasks.length ? placeholderText : emptyText;
    select.appendChild(placeholder);

    tasks.forEach((task) => {
      if (!task?.code) {
        return;
      }
      const option = document.createElement("option");
      option.value = task.code;
      option.textContent = `${task.code}${task.name ? ` ${task.name}` : ""}`.trim();
      select.appendChild(option);
    });

    if (previousValue && tasks.some((task) => task.code === previousValue)) {
      select.value = previousValue;
    }
  });
}

function renderSampleTaskSummary(taskList, samples) {
  const select = document.querySelector('select[data-sample-task-select="summary"]');
  const countEl = document.getElementById("sample-task-count");
  if (!select || !countEl) {
    return;
  }
  const tasks = Array.isArray(taskList) ? taskList : [];
  const sampleList = Array.isArray(samples) ? samples : [];

  const updateCount = () => {
    const code = (select.value || "").trim();
    if (!code) {
      countEl.textContent = "0";
      return;
    }
    const task = tasks.find((item) => item.code === code);
    const rawCount = task?.sample_count ?? 0;
    if (rawCount !== "" && Number.isFinite(Number(rawCount))) {
      countEl.textContent = String(rawCount);
      return;
    }
    const actualCount = sampleList.filter((sample) => sample.task_code === code).length;
    countEl.textContent = String(actualCount);
  };

  if (select.dataset.bound !== "1") {
    select.addEventListener("change", updateCount);
    select.dataset.bound = "1";
  }

  updateCount();
}

function renderSamplesPage(labels) {
  const tbody = document.getElementById("sample-table-body");
  if (!tbody) {
    return;
  }
  let samples = loadStore(STORAGE_KEYS.samples, []);
  if (!Array.isArray(samples)) {
    samples = [];
  }

  tbody.innerHTML = "";
  samples.forEach((sample) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${sample.code || ""}</td>
      <td>${sample.task_code || ""}</td>
      <td>${sample.location || ""}</td>
      <td>${sample.owner || ""}</td>
      <td><span class="${statusClass(sample.status, labels)}">${sample.status || ""}</span></td>
      <td><a class="action-link" href="#" data-drawer-open="sample-drawer">${labels.edit}</a></td>
    `;
    tbody.appendChild(row);
  });
  let tasks = loadStore(STORAGE_KEYS.tasks, []);
  let schedules = loadStore(STORAGE_KEYS.schedules, []);
  if (!Array.isArray(tasks)) {
    tasks = [];
  }
  if (!Array.isArray(schedules)) {
    schedules = [];
  }
  const sampleTasks = buildSampleTaskList(tasks, samples, schedules);
  fillSampleTaskSelects(sampleTasks);
  renderSampleTaskSummary(sampleTasks, samples);
  renderStagingSamples(labels, samples);
  const traceInput = document.querySelector('[data-form="sample-trace"] input[name="task_code"]');
  renderSampleTrace(labels, traceInput ? traceInput.value : "");
}

function renderDevicesPage(labels) {
  const tbody = document.getElementById("device-table-body");
  if (!tbody) {
    return;
  }
  let devices = loadStore(STORAGE_KEYS.devices, []);
  let schedules = loadStore(STORAGE_KEYS.schedules, []);
  if (!Array.isArray(devices)) {
    devices = [];
  }
  if (!Array.isArray(schedules)) {
    schedules = [];
  }
  const computed = devices.map((device) => ({
    ...device,
    status: computeDeviceStatus(device, schedules, labels),
  }));
  const idleCount = computed.filter((d) => d.status === labels.deviceIdle).length;
  const activeCount = computed.filter((d) => d.status === labels.deviceInUse).length;
  const maintenanceCount = computed.filter((d) => d.status === labels.deviceMaintenance).length;

  setText("device-idle-count", idleCount);
  setText("device-active-count", activeCount);
  setText("device-maintenance-count", maintenanceCount);

  tbody.innerHTML = "";
  computed.forEach((device) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${device.code || ""}</td>
      <td>${device.name || ""}</td>
      <td>${device.type || ""}</td>
      <td><span class="${statusClass(device.status, labels)}">${device.status || ""}</span></td>
      <td>${device.location || ""}</td>
      <td>${device.next_cal || ""}</td>
      <td><a class="action-link" href="#" data-drawer-open="device-drawer">${labels.detail}</a></td>
    `;
    tbody.appendChild(row);
  });
}

// Schedule table with computed status pills.
function renderSchedulePage(labels) {
  const tbody = document.getElementById("schedule-table-body");
  if (!tbody) {
    return;
  }
  let schedules = loadStore(STORAGE_KEYS.schedules, []);
  let devices = loadStore(STORAGE_KEYS.devices, []);
  if (!Array.isArray(schedules)) {
    schedules = [];
  }
  if (!Array.isArray(devices)) {
    devices = [];
  }
  const now = new Date();
  const retentionStatus = labels.statusRetention || "\u6682\u5b58\u95f4\u5b58\u653e";
  const runningStatus = labels.statusRunning || "\u6267\u884c\u4e2d";
  const scheduledStatus = labels.statusScheduled || "\u5df2\u6392\u7a0b";
  const filteredSchedules = schedules.filter(
    (entry) => !(entry.device === labels.retentionLocation && RETENTION_EXCLUDE_CODES.has(entry.task_code))
  );
  if (filteredSchedules.length !== schedules.length) {
    const removedCodes = new Set(
      schedules
        .filter((entry) => entry.device === labels.retentionLocation && RETENTION_EXCLUDE_CODES.has(entry.task_code))
        .map((entry) => entry.task_code)
        .filter(Boolean)
    );
    schedules = filteredSchedules;
    saveStore(STORAGE_KEYS.schedules, schedules);
    if (removedCodes.size) {
      const tasks = loadStore(STORAGE_KEYS.tasks, []);
      const remainingCodes = new Set(schedules.map((entry) => entry.task_code).filter(Boolean));
      let updated = false;
      tasks.forEach((task) => {
        if (removedCodes.has(task.code) && !remainingCodes.has(task.code)) {
          task.status = labels.statusWaiting;
          updated = true;
        }
      });
      if (updated) {
        saveStore(STORAGE_KEYS.tasks, tasks);
      }
    }
  }
  const computed = schedules.map((entry) => {
    const start = new Date(entry.start_at);
    const end = new Date(entry.end_at);
    const status =
      entry.device === labels.retentionLocation
        ? retentionStatus
        : start <= now && end >= now
          ? runningStatus
          : scheduledStatus;
    return { ...entry, status };
  });

  tbody.innerHTML = "";
  computed.forEach((entry) => {
    const row = document.createElement("tr");
    if (entry.id) {
      row.dataset.scheduleId = entry.id;
    }
    row.innerHTML = `
      <td>${entry.task_code || ""}</td>
      <td>${entry.device || ""}</td>
      <td>${formatDateTime(entry.start_at)}</td>
      <td>${formatDateTime(entry.end_at)}</td>
      <td><span class="${statusClass(entry.status, labels)}">${entry.status}</span></td>
      <td><a class="action-link" href="#" data-action="schedule-edit" data-schedule-id="${entry.id || ""}">${
        labels.edit
      }</a></td>
    `;
    tbody.appendChild(row);
  });

  const conflicts = [];
  const byDevice = {};
  const conflictIgnored = new Set([labels.retentionLocation].filter(Boolean));
  computed.forEach((entry) => {
    if (conflictIgnored.has(entry.device)) {
      return;
    }
    if (!byDevice[entry.device]) {
      byDevice[entry.device] = [];
    }
    byDevice[entry.device].push(entry);
  });
  Object.values(byDevice).forEach((entries) => {
    const sorted = entries.sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    for (let i = 1; i < sorted.length; i += 1) {
      const prev = sorted[i - 1];
      const next = sorted[i];
      if (new Date(prev.end_at) > new Date(next.start_at)) {
        conflicts.push({
          schedule_id: next.id || "",
          task_code: next.task_code,
          device: next.device,
          reason: labels.conflictOverlap,
          impact: labels.conflictDelay,
          suggestion: labels.conflictReschedule,
        });
      }
    }
  });

  const conflictBody = document.getElementById("conflict-table-body");
  if (conflictBody) {
    conflictBody.innerHTML = "";
    conflicts.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.task_code}</td>
        <td>${item.device}</td>
        <td>${item.reason}</td>
        <td>${item.impact}</td>
        <td>${item.suggestion}</td>
        <td><a class="action-link" href="#" data-action="schedule-edit" data-schedule-id="${item.schedule_id}">${
          labels.edit
        }</a></td>
      `;
      conflictBody.appendChild(row);
    });
  }

  setText("schedule-conflict-count", conflicts.length);
  setText("schedule-next-auto", formatDateTime(new Date(Date.now() + 60 * 60 * 1000)));
  setText("schedule-change-count", 0);
  let samples = loadStore(STORAGE_KEYS.samples, []);
  if (!Array.isArray(samples)) {
    samples = [];
  }
  renderUnpackingSchedule(labels, samples);
  renderRetentionSchedule(labels, samples);
  renderRetentionInternalSchedule(labels);
  renderScheduleFormOptions(labels, devices);
  const scheduleForm = document.querySelector('[data-form="manual-schedule"]');
  let filterDevice = scheduleForm?.dataset.ganttFilter || scheduleForm?.querySelector('select[name="device"]')?.value || "";
  if (labels.retentionLocation && filterDevice === labels.retentionLocation) {
    filterDevice = "";
  }
  const ganttEntries = computed.filter((entry) => !conflictIgnored.has(entry.device));
  renderGanttSchedule(ganttEntries, devices, filterDevice);
}

// Build task/lab options for the manual schedule form.
function renderScheduleFormOptions(labels, devices) {
  const form = document.querySelector('[data-form="manual-schedule"]');
  if (!form) {
    return;
  }
  const taskSelect = form.querySelector('select[name="task_code"]');
  const labSelect = form.querySelector('select[name="device"]');
  if (!taskSelect || !labSelect) {
    return;
  }

  const tasks = loadStore(STORAGE_KEYS.tasks, []);
  const schedules = loadStore(STORAGE_KEYS.schedules, []);
  const tabGroup = document.querySelector('[data-tab-group="schedule-board"][data-tab-role="tabs"]');
  const activeTab = tabGroup?.querySelector(".tab-btn.active");
  const isRetentionTab = activeTab?.getAttribute("data-tab-btn") === "retention";
  const retentionTaskCodes = new Set();
  if (isRetentionTab && labels.retentionLocation) {
    schedules.forEach((entry) => {
      if (
        entry.device === labels.retentionLocation &&
        entry.task_code &&
        !RETENTION_EXCLUDE_CODES.has(entry.task_code)
      ) {
        retentionTaskCodes.add(entry.task_code);
      }
    });
  }
  const candidates = isRetentionTab
    ? tasks.filter((task) => retentionTaskCodes.has(task.code) && !isRetentionExcludedTask(task))
    : tasks.filter((task) => task.status === labels.statusAccepted);
  const previousTask = taskSelect.value;
  const taskPlaceholderText = taskSelect.dataset.placeholder || "Select task";
  const taskEmptyText = taskSelect.dataset.emptyPlaceholder || "No tasks";
  const labPlaceholderText = labSelect.dataset.placeholder || "Select lab";
  const labEmptyText = labSelect.dataset.emptyPlaceholder || "Select task";
  const labCustomText = labSelect.dataset.customLabel || "Other/Custom";

  taskSelect.innerHTML = "";
  const taskPlaceholder = document.createElement("option");
  taskPlaceholder.value = "";
  taskPlaceholder.textContent = candidates.length ? taskPlaceholderText : taskEmptyText;
  taskSelect.appendChild(taskPlaceholder);
  candidates.forEach((task) => {
    if (!task.code) {
      return;
    }
    const option = document.createElement("option");
    option.value = task.code;
    option.textContent = `${task.code}${task.name ? ` ${task.name}` : ""}`.trim();
    option.dataset.testType = task.test_type || "";
    taskSelect.appendChild(option);
  });

  if (previousTask && candidates.some((task) => task.code === previousTask)) {
    taskSelect.value = previousTask;
  }

  const updateLabOptions = () => {
    const selectedCode = taskSelect.value;
    const selectedOption = taskSelect.options[taskSelect.selectedIndex];
    const testType = selectedOption?.dataset?.testType || "";
    const hasTask = Boolean(selectedCode);
    const currentTab = document.querySelector('[data-tab-group="schedule-board"][data-tab-role="tabs"]')
      ?.querySelector(".tab-btn.active")
      ?.getAttribute("data-tab-btn");
    const retentionActive = currentTab === "retention";
    let labs = hasTask ? getLabsForTestType(testType) : [];
    if (hasTask && labels.retentionLocation && !retentionActive && !labs.includes(labels.retentionLocation)) {
      labs.push(labels.retentionLocation);
    }
    if (retentionActive && labels.retentionLocation) {
      labs = labs.filter((lab) => lab !== labels.retentionLocation);
    }
    const prevLab = labSelect.value;

    labSelect.innerHTML = "";
    const labPlaceholder = document.createElement("option");
    labPlaceholder.value = "";
    labPlaceholder.textContent = hasTask ? labPlaceholderText : labEmptyText;
    labSelect.appendChild(labPlaceholder);

    labs.forEach((lab) => {
      const option = document.createElement("option");
      option.value = lab;
      option.textContent = lab;
      labSelect.appendChild(option);
    });

    if (hasTask) {
      const customOption = document.createElement("option");
      customOption.value = labCustomText;
      customOption.textContent = labCustomText;
      labSelect.appendChild(customOption);
    }

    if (prevLab && labs.includes(prevLab)) {
      labSelect.value = prevLab;
      return;
    }
    if (labels.retentionLocation && prevLab === labels.retentionLocation) {
      labSelect.value = "";
    }
  };

  
  if (tabGroup && tabGroup.dataset.scheduleTaskFilterBound !== "1") {
    tabGroup.addEventListener("click", () => {
      setTimeout(() => {
        renderScheduleFormOptions(labels, devices);
        renderRetentionInternalSchedule(labels);
      }, 0);
    });
    tabGroup.dataset.scheduleTaskFilterBound = "1";
  }

  if (!taskSelect.dataset.bound) {
    taskSelect.addEventListener("change", updateLabOptions);
    taskSelect.dataset.bound = "1";
  }
  updateLabOptions();
  const syncManual = typeof window !== "undefined" ? window.__MES_SYNC_MANUAL_SCHEDULE__ : null;
  if (typeof syncManual === "function") {
    syncManual();
  }
}

function renderDataPage(labels) {
  const tbody = document.getElementById("data-table-body");
  if (!tbody) {
    return;
  }
  const streams = loadStore(STORAGE_KEYS.streams, []);
  const validationCount = streams.filter((s) => s.status !== labels.dataComplete).length;
  const reportQueue = streams.filter((s) => s.status === labels.dataComplete && !s.reported).length;

  setText("data-stream-count", streams.length);
  setText("data-validation-count", validationCount);
  setText("data-report-count", reportQueue);

  tbody.innerHTML = "";
  streams.forEach((stream) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${stream.task_code || ""}</td>
      <td>${stream.device || ""}</td>
      <td>${stream.last_packet || ""}</td>
      <td>${stream.quality || ""}</td>
      <td><span class="${statusClass(stream.status, labels)}">${stream.status}</span></td>
      <td><a class="action-link" href="#" data-drawer-open="data-drawer">${labels.detail}</a></td>
    `;
    tbody.appendChild(row);
  });
}

function renderDashboardPage(labels) {
  const taskBody = document.getElementById("dashboard-task-body");
  if (!taskBody) {
    return;
  }
  const pagination = document.getElementById("dashboard-task-pagination");
  let tasks = loadStore(STORAGE_KEYS.tasks, []);
  let schedules = loadStore(STORAGE_KEYS.schedules, []);
  let devices = loadStore(STORAGE_KEYS.devices, []);
  let streams = loadStore(STORAGE_KEYS.streams, []);
  if (!Array.isArray(tasks)) {
    tasks = [];
  }
  if (!Array.isArray(schedules)) {
    schedules = [];
  }
  if (!Array.isArray(devices)) {
    devices = [];
  }
  if (!Array.isArray(streams)) {
    streams = [];
  }

  const now = new Date();
  const retentionStatus = labels.statusRetention || "暂存间排放";
  const runningStatus = labels.statusExperimenting || labels.statusRunning || "实验中";
  const completedStatus = labels.statusCompleted || "实验已经完成";
  const scheduledStatus = labels.statusScheduled || "已排程";
  const schedulesByTask = new Map();
  let taskStatusUpdated = false;
  schedules.forEach((entry) => {
    if (!entry?.task_code) {
      return;
    }
    if (!schedulesByTask.has(entry.task_code)) {
      schedulesByTask.set(entry.task_code, []);
    }
    schedulesByTask.get(entry.task_code).push(entry);
  });
  const resolveTaskStatus = (task) => {
    const entries = schedulesByTask.get(task.code) || [];
    if (!entries.length) {
      return task.status || "";
    }
    const labEntries = entries.filter((entry) => entry.device !== labels.retentionLocation);
    const retentionEntries = entries.filter((entry) => entry.device === labels.retentionLocation);
    if (!labEntries.length && retentionEntries.length) {
      return retentionStatus;
    }
    if (!labEntries.length) {
      return task.status || scheduledStatus;
    }
    const validEntries = labEntries.filter((entry) => {
      const start = new Date(entry.start_at);
      const end = new Date(entry.end_at);
      return !Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime());
    });
    if (!validEntries.length) {
      return scheduledStatus;
    }
    const hasActive = validEntries.some((entry) => {
      const start = new Date(entry.start_at);
      const end = new Date(entry.end_at);
      return start <= now && end >= now;
    });
    if (hasActive) {
      return runningStatus;
    }
    const allEnded = validEntries.every((entry) => new Date(entry.end_at) < now);
    if (allEnded) {
      return completedStatus;
    }
    return scheduledStatus;
  };

  let runningTaskCount = 0;
  tasks.forEach((task) => {
    const status = resolveTaskStatus(task);
    if (status && status !== task.status) {
      task.status = status;
      taskStatusUpdated = true;
    }
    if (status === runningStatus) {
      runningTaskCount += 1;
    }
  });
  if (taskStatusUpdated) {
    saveStore(STORAGE_KEYS.tasks, tasks);
  }

  const externalCount = tasks.filter((t) => t.source === labels.sourceExternal).length;
  const internalCount = tasks.filter((t) => t.source === labels.sourceInternal).length;
  const waitingCount = tasks.filter(
    (t) => t.status === labels.statusWaiting || t.status === labels.statusAccepted
  ).length;
  const retentionCount = tasks.filter((t) => t.status === labels.statusRetention).length;
  const unscheduledCount = waitingCount + retentionCount;
  setText("dashboard-intake-count", tasks.length);
  setText("dashboard-intake-note", `${labels.sourceExternal} ${externalCount} / ${labels.sourceInternal} ${internalCount}`);
  const scheduledCount = schedules.filter((entry) => entry.device !== labels.retentionLocation).length;
  setText("dashboard-scheduled-count", scheduledCount);
  setText("dashboard-unscheduled-count", `${unscheduledCount}（暂存间存放${retentionCount}）`);

  const computedDevices = devices.map((device) => ({
    ...device,
    status: computeDeviceStatus(device, schedules, labels),
  }));
  const activeDevices = computedDevices.filter((d) => d.status === labels.deviceInUse).length;
  const maintenanceDevices = computedDevices.filter((d) => d.status === labels.deviceMaintenance).length;
  setText("dashboard-device-count", runningTaskCount);
  setText("dashboard-device-note", "实验中任务");

  const gapCount = streams.filter((s) => s.status === labels.dataGap).length;
  setText("dashboard-alert-count", gapCount);
  setText("dashboard-alert-note", gapCount > 0 ? labels.alertGap : labels.alertNone);

  const pageSize = 8; // 中控总览中任务队列每页任务数量
  const totalPages = Math.max(1, Math.ceil(tasks.length / pageSize));
  let currentPage = pagination ? Number.parseInt(pagination.dataset.page || "1", 10) : 1;
  if (!Number.isFinite(currentPage) || currentPage < 1) {
    currentPage = 1;
  }
  if (currentPage > totalPages) {
    currentPage = totalPages;
  }
  if (pagination) {
    pagination.dataset.page = String(currentPage);
    pagination.dataset.total = String(totalPages);
  }

  const startIndex = (currentPage - 1) * pageSize;
  const pageItems = tasks.slice(startIndex, startIndex + pageSize);

  taskBody.innerHTML = "";
  pageItems.forEach((task) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${task.code || ""}</td>
      <td>${task.source || ""}</td>
      <td><span class="${statusClass(task.status, labels)}">${task.status || ""}</span></td>
    `;
    taskBody.appendChild(row);
  });

  if (pagination) {
    const appendEllipsis = () => {
      const span = document.createElement("span");
      span.className = "page-ellipsis";
      span.textContent = "...";
      pagination.appendChild(span);
    };
    const appendPage = (page) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `page-btn${page === currentPage ? " active" : ""}`;
      btn.textContent = String(page);
      btn.dataset.page = String(page);
      pagination.appendChild(btn);
    };
    const appendNav = (label, action, disabled) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "page-btn nav";
      btn.textContent = label;
      btn.dataset.page = action;
      btn.disabled = disabled;
      pagination.appendChild(btn);
    };

    pagination.innerHTML = "";
    if (totalPages <= 1) {
      pagination.classList.add("is-hidden");
    } else {
      pagination.classList.remove("is-hidden");
      appendNav("上一页", "prev", currentPage <= 1);

      if (totalPages <= 5) {
        for (let i = 1; i <= totalPages; i += 1) {
          appendPage(i);
        }
      } else if (currentPage <= 3) {
        [1, 2, 3, 4].forEach((page) => appendPage(page));
        appendEllipsis();
        appendPage(totalPages);
      } else if (currentPage >= totalPages - 2) {
        appendPage(1);
        appendEllipsis();
        [totalPages - 3, totalPages - 2, totalPages - 1, totalPages].forEach((page) => appendPage(page));
      } else {
        appendPage(1);
        appendEllipsis();
        [currentPage - 1, currentPage, currentPage + 1].forEach((page) => appendPage(page));
        appendEllipsis();
        appendPage(totalPages);
      }

      appendNav("下一页", "next", currentPage >= totalPages);

      if (pagination.dataset.bound !== "1") {
        pagination.addEventListener("click", (event) => {
          const target = event.target.closest(".page-btn");
          if (!target || target.disabled) {
            return;
          }
          const action = target.dataset.page || "";
          const total = Number.parseInt(pagination.dataset.total || "1", 10);
          let current = Number.parseInt(pagination.dataset.page || "1", 10);
          if (!Number.isFinite(current) || current < 1) {
            current = 1;
          }
          const maxPage = Number.isFinite(total) && total > 0 ? total : 1;
          let nextPage = current;
          if (action === "prev") {
            nextPage = Math.max(1, current - 1);
          } else if (action === "next") {
            nextPage = Math.min(maxPage, current + 1);
          } else {
            const parsed = Number.parseInt(action, 10);
            if (Number.isFinite(parsed)) {
              nextPage = parsed;
            }
          }
          if (nextPage === current) {
            return;
          }
          pagination.dataset.page = String(nextPage);
          renderDashboardPage(labels);
        });
        pagination.dataset.bound = "1";
      }
    }
  }

  const deviceList = document.getElementById("dashboard-device-list");
  if (deviceList) {
    deviceList.innerHTML = "";
    computedDevices.forEach((device) => {
      const item = document.createElement("div");
      item.className = "timeline-item";
      item.innerHTML = `
        <div class="timeline-dot"></div>
        <div>
          <div>${device.code}</div>
          <div class="muted">${device.status}</div>
        </div>
      `;
      deviceList.appendChild(item);
    });
  }

  const avgQuality =
    streams.length === 0
      ? 0
      : Math.round(
          (streams.reduce((sum, stream) => sum + parseFloat(stream.quality || 0), 0) / streams.length) * 10
        ) / 10;
  setText("dashboard-data-health", `${Number.isNaN(avgQuality) ? 0 : avgQuality}%`);
  setText("dashboard-data-gap", gapCount > 0 ? labels.gapRecorded : labels.gapNone);
}

function renderAll(labels) {
  renderTasksPage(labels);
  renderSchedulePage(labels);
  renderSamplesPage(labels);
  renderDevicesPage(labels);
  renderDataPage(labels);
  renderDashboardPage(labels);
}

export { renderAll, renderSampleTrace };
