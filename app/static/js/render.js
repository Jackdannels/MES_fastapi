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

function createTaskStatusResolver(tasks, schedules, labels, now = new Date()) {
  const retentionStatus = labels.statusRetention || "暂存间存放";
  const runningStatus = labels.statusExperimenting || labels.statusRunning || "实验中";
  const completedStatus = labels.statusCompleted || "实验已经完成";
  const scheduledStatus = labels.statusScheduled || "已排程";
  const schedulesByTask = new Map();

  (Array.isArray(schedules) ? schedules : []).forEach((entry) => {
    if (!entry?.task_code) {
      return;
    }
    if (!schedulesByTask.has(entry.task_code)) {
      schedulesByTask.set(entry.task_code, []);
    }
    schedulesByTask.get(entry.task_code).push(entry);
  });

  const resolveTaskStatus = (taskOrCode, fallback = "") => {
    const code = typeof taskOrCode === "string" ? taskOrCode : taskOrCode?.code || "";
    const baseStatus = typeof taskOrCode === "string" ? fallback : taskOrCode?.status || fallback;
    if (!code) {
      return baseStatus || "";
    }

    const entries = schedulesByTask.get(code) || [];
    if (!entries.length) {
      return baseStatus || "";
    }

    const labEntries = entries.filter((entry) => entry.device !== labels.retentionLocation);
    const retentionEntries = entries.filter((entry) => entry.device === labels.retentionLocation);
    if (!labEntries.length && retentionEntries.length) {
      return retentionStatus;
    }
    if (!labEntries.length) {
      return baseStatus || scheduledStatus;
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

  return { resolveTaskStatus, retentionStatus, runningStatus, completedStatus, scheduledStatus };
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
  const now = new Date();
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
          const entryStart = new Date(entries[0].start_at);
          const entryEnd = new Date(entries[0].end_at);
          if (!Number.isNaN(entryStart.getTime()) && !Number.isNaN(entryEnd.getTime())) {
            if (entryEnd < now) {
              slot.classList.add("completed");
            } else if (entryStart <= now && entryEnd >= now) {
              slot.classList.add("running");
            }
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
  const searchInput = document.getElementById("task-list-search");
  const testTypeFilter = document.getElementById("task-list-filter-test-type");
  const statusFilter = document.getElementById("task-list-filter-status");
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

  const { resolveTaskStatus, retentionStatus } = createTaskStatusResolver(tasks, schedules, labels, new Date());
  let taskStatusUpdated = normalizedStatusUpdated;

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
    if (effectiveStatus === retentionStatus || effectiveStatus === labels.statusRetention) {
      retentionCount += 1;
    }
    if (effectiveStatus === labels.statusWaiting || effectiveStatus === labels.statusAccepted) {
      waitingCount += 1;
    }
    rows.push({ task, displayStatus });
  });

  const fillFilterSelect = (select, values, placeholder) => {
    if (!select) {
      return;
    }
    const previous = select.value;
    select.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = placeholder;
    select.appendChild(defaultOption);
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      select.appendChild(option);
    });
    if (previous && values.includes(previous)) {
      select.value = previous;
    }
  };

  const testTypeValues = Array.from(
    new Set(
      rows
        .map(({ task }) => (task.test_type || "").trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  const statusValues = Array.from(
    new Set(
      rows
        .map(({ displayStatus }) => (displayStatus || "").trim())
        .filter(Boolean)
    )
  );
  fillFilterSelect(testTypeFilter, testTypeValues, "全部试验类型");
  fillFilterSelect(statusFilter, statusValues, "全部状态");

  const query = (searchInput?.value || "").trim().toLowerCase();
  const selectedType = (testTypeFilter?.value || "").trim();
  const selectedStatus = (statusFilter?.value || "").trim();
  const filteredRows = rows.filter(({ task, displayStatus }) => {
    if (selectedType && (task.test_type || "") !== selectedType) {
      return false;
    }
    if (selectedStatus && (displayStatus || "") !== selectedStatus) {
      return false;
    }
    if (!query) {
      return true;
    }
    const searchText = [
      task.code || "",
      task.name || "",
      task.source || "",
      task.test_type || "",
      task.required_device || "",
      displayStatus || "",
    ]
      .join(" ")
      .toLowerCase();
    return searchText.includes(query);
  });

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
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
  const pageItems = filteredRows.slice(startIndex, startIndex + pageSize);

  tbody.innerHTML = "";
  pageItems.forEach(({ task, displayStatus }, index) => {
    const serial = startIndex + index + 1;
    const row = document.createElement("tr");
    if (task.id) {
      row.dataset.taskId = task.id;
    }
    if (task.code) {
      row.dataset.taskCode = task.code;
    }
    row.innerHTML = `
      <td>${serial}</td>
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
  const bindTaskFilters = (element, eventName) => {
    if (!element || element.dataset.bound === "1") {
      return;
    }
    element.addEventListener(eventName, () => {
      if (pagination) {
        pagination.dataset.page = "1";
      }
      renderTasksPage(labels);
    });
    element.dataset.bound = "1";
  };
  bindTaskFilters(searchInput, "input");
  bindTaskFilters(testTypeFilter, "change");
  bindTaskFilters(statusFilter, "change");

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
  const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
  const stagingSamples = samples.filter(
    (sample) => sample.location === preRetentionLocation && sample.status !== labels.sampleTesting
  );
  setText("staging-count", stagingSamples.length);
  body.innerHTML = "";
  stagingSamples.forEach((sample, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
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
  unpackingSamples.forEach((sample, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
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
  const preRetentionLocation = labels?.preRetentionLocation || labels?.retentionLocation;
  if (sample.retention_source) {
    return sample.retention_source === "intake";
  }
  if (preRetentionLocation && sample.location === preRetentionLocation) {
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
  const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
  const retentionSamples = samples.filter(
    (sample) =>
      sample.location === preRetentionLocation &&
      sample.status !== labels.sampleTesting &&
      isRetentionFromIntake(sample, labels)
  );
  setText("retention-schedule-count", retentionSamples.length);
  body.innerHTML = "";
  retentionSamples.forEach((sample, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
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

  const preRetentionLocation = labels.preRetentionLocation || labels.retentionLocation;
  const scheduledToLab = new Set(
    schedules
      .filter((entry) => entry?.task_code && entry?.device && entry.device !== preRetentionLocation)
      .map((entry) => entry.task_code)
  );
  const retentionSchedules = schedules.filter(
    (entry) => entry?.task_code && entry?.device === preRetentionLocation
  );

  const retentionTasks = new Map();
  const retentionSamples = samples.filter(
    (sample) =>
      sample.location === preRetentionLocation &&
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
    row.innerHTML = `<td class="muted" colspan="5">\u6682\u65e0\u6682\u5b58\u95f4\u5f85\u5206\u914d\u4efb\u52a1</td>`;
    body.appendChild(row);
    return;
  }

  list.forEach((item, index) => {
    const row = document.createElement("tr");
    const sinceText = item.since ? formatDateTime(item.since) : "-";
    row.innerHTML = `
      <td>${index + 1}</td>
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

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildTaskSampleCodes(taskCode, plannedCount, samplesForTask) {
  const code = (taskCode || "").trim();
  if (!code) {
    return [];
  }
  const list = Array.isArray(samplesForTask) ? samplesForTask : [];
  const existingCodes = Array.from(
    new Set(
      list
        .map((item) => (item?.code || "").trim())
        .filter(Boolean)
    )
  );
  const pattern = new RegExp(`^${escapeRegExp(code)}-SP-(\\d{3})$`);
  let maxIndex = 0;
  existingCodes.forEach((itemCode) => {
    const match = itemCode.match(pattern);
    if (!match) {
      return;
    }
    const index = Number.parseInt(match[1], 10);
    if (Number.isFinite(index)) {
      maxIndex = Math.max(maxIndex, index);
    }
  });
  let targetCount = Number.isFinite(plannedCount) && plannedCount > 0 ? Math.floor(plannedCount) : existingCodes.length;
  if (targetCount <= 0 && maxIndex > 0) {
    targetCount = maxIndex;
  }
  const generatedCodes = [];
  for (let index = 1; index <= targetCount; index += 1) {
    generatedCodes.push(`${code}-SP-${String(index).padStart(3, "0")}`);
  }
  return generatedCodes;
}

function buildSampleTrayCode(sampleCode, serial) {
  const code = (sampleCode || "").trim();
  const index = Number.parseInt(serial, 10);
  if (!code || !Number.isFinite(index) || index <= 0) {
    return "";
  }
  return `${code}-TP-${String(index).padStart(3, "0")}`;
}

function buildTaskTrayCode(taskCode, serial) {
  const code = (taskCode || "").trim();
  const index = Number.parseInt(serial, 10);
  if (!code || !Number.isFinite(index) || index <= 0) {
    return "";
  }
  return `${code}-TP-${String(index).padStart(3, "0")}`;
}

function parseSampleTrayPlan(value) {
  const lines = String(value || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const entries = [];
  const errors = [];
  lines.forEach((line, index) => {
    const parts = line
      .split(/[,\uff0c;\uff1b|\t]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (parts.length < 2) {
      errors.push(`第${index + 1}行格式错误，应为“样品编号,托盘数量[,托盘编号]”`);
      return;
    }
    let sampleCode = parts[0];
    let quantityText = parts[1];
    let trayCode = parts[2] || "";
    if (parts.length >= 3 && /-TP-\d{3}$/i.test(parts[0])) {
      trayCode = parts[0];
      sampleCode = parts[1];
      quantityText = parts[2];
    }
    const quantity = Number.parseInt(quantityText, 10);
    if (!sampleCode) {
      errors.push(`第${index + 1}行缺少样品编号`);
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      errors.push(`第${index + 1}行托盘数量必须为正整数`);
      return;
    }
    entries.push({
      sampleCode,
      quantity: Math.floor(quantity),
      trayCode: (trayCode || "").trim(),
    });
  });
  return { entries, errors };
}

function getSampleTrayList(sample) {
  if (!sample || !Array.isArray(sample.trays)) {
    return [];
  }
  const sampleCode = (sample.code || "").trim();
  return sample.trays
    .filter((tray) => {
      if (!tray) {
        return false;
      }
      const traySampleCode = (tray.sample_code || sampleCode || "").trim();
      const quantity = Number.parseInt(tray.quantity, 10);
      return traySampleCode === sampleCode && Number.isFinite(quantity) && quantity > 0;
    })
    .map((tray, index) => ({
      tray_code: tray.tray_code || buildSampleTrayCode(sampleCode, index + 1),
      sample_code: sampleCode,
      quantity: Math.floor(Number.parseInt(tray.quantity, 10)),
    }));
}

const UNIFIED_SAMPLE_FLOW_STEPS = [
  "运输中",
  "到货",
  "到达实验间",
  "实验准备就绪",
  "实验完成",
  "放置暂存间",
  "厂家收回",
];

function resolveSampleFlowStageIndex(sample, labels) {
  if (!sample) {
    return 0;
  }
  const flowStatus = (sample.flow_status || sample.status || "").trim();
  const location = (sample.location || "").trim();
  const preRetentionLocation = labels?.preRetentionLocation || labels?.retentionLocation || "";
  const postRetentionLocation = labels?.postRetentionLocation || "";
  const isPreRetention = Boolean(preRetentionLocation) && location === preRetentionLocation;
  const isPostRetention = Boolean(postRetentionLocation) && location === postRetentionLocation;
  if (!flowStatus && !location) {
    return 0;
  }
  if (flowStatus === "厂家收回" || flowStatus === "已处置") {
    return 6;
  }
  if (flowStatus === "放置暂存间" && (!location || isPostRetention)) {
    return 5;
  }
  if (flowStatus === "入库" || flowStatus === "已入库" || flowStatus === labels?.sampleStored) {
    return isPostRetention ? 5 : 1;
  }
  if (flowStatus === "实验完成" || flowStatus === labels?.statusCompleted || flowStatus === "实验已完成") {
    return 4;
  }
  if (flowStatus === "实验准备就绪" || flowStatus === "试验中" || flowStatus === labels?.sampleTesting) {
    return 3;
  }
  if (flowStatus === "到达实验间" || TEST_LABS.includes(location)) {
    return 2;
  }
  if (flowStatus === "到货" || flowStatus === "已接收" || flowStatus === labels?.sampleReceived) {
    return 1;
  }
  if (isPostRetention) {
    return 5;
  }
  if (isPreRetention) {
    return 1;
  }
  if (location && TEST_LABS.includes(location)) {
    return 2;
  }
  if (location && (location === labels?.unpackingLocation || location === labels?.intakeLocation)) {
    return 1;
  }
  return 0;
}

function renderUnifiedSampleFlow(stageIndex) {
  const flowContainer = document.getElementById("sample-flow-unified");
  const currentEl = document.getElementById("sample-flow-current");
  if (!flowContainer) {
    return;
  }
  const normalized = Number.isFinite(stageIndex) ? Math.max(-1, Math.min(6, stageIndex)) : -1;
  flowContainer.querySelectorAll("li[data-flow-step]").forEach((item) => {
    const step = Number.parseInt(item.dataset.flowStep || "-1", 10);
    const reached = Number.isFinite(step) && normalized >= step && normalized >= 0;
    item.classList.toggle("reached", reached);
    item.classList.toggle("current", Number.isFinite(step) && step === normalized && normalized >= 0);
  });
  if (currentEl) {
    currentEl.textContent =
      normalized >= 0 ? `当前状态：${UNIFIED_SAMPLE_FLOW_STEPS[normalized]}` : "当前状态：未选择任务";
  }
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

function renderSampleTaskSummary(taskList, samples, labels) {
  const DEFAULT_TRAY_LIMIT = 5;
  const DEFAULT_TRAY_COUNT = 2;
  const select = document.querySelector('select[data-sample-task-select="summary"]');
  const countEl = document.getElementById("sample-task-count");
  const countHintEl = document.getElementById("sample-task-count-hint");
  const processForm = document.querySelector('[data-form="sample-task-process"]');
  const codesInput = processForm?.querySelector('textarea[name="codes"]') || null;
  const trayPlanInput = processForm?.querySelector('textarea[name="tray_plan"]') || null;
  const trayPreviewInput = processForm?.querySelector('textarea[name="tray_preview"]') || null;
  const traySource = document.getElementById("sample-tray-source");
  const traySourcePanel = traySource?.closest(".sample-tray-source") || null;
  const traySourceHint = document.getElementById("sample-tray-source-hint");
  const trayList = document.getElementById("sample-tray-list");
  const trayLimitInput = document.getElementById("sample-tray-limit-input");
  const trayAddBtn = document.querySelector('[data-action="sample-tray-add"]');
  const storeBtn = document.querySelector('[data-action="sample-task-store"]');
  const printBtn = document.querySelector('[data-action="sample-tray-print"]');
  if (!select || !countEl) {
    return;
  }
  const tasks = Array.isArray(taskList) ? taskList : [];
  const sampleList = Array.isArray(samples) ? samples : [];
  const trayDraft = {
    taskCode: "",
    sampleCodes: [],
    trays: [],
    activeIndex: -1,
    maxPerTray: DEFAULT_TRAY_LIMIT,
  };
  let traySeed = 0;

  const nextTrayId = () => {
    traySeed += 1;
    return `tray-draft-${Date.now()}-${traySeed}`;
  };

  const compareSampleCode = (left, right) => String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");
  const normalizeTrayCapacity = (value, fallback = 1) => {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return Math.max(1, Number.parseInt(fallback, 10) || 1);
    }
    return Math.floor(parsed);
  };
  const getRequiredTrayCount = (totalSamples, maxPerTray) => {
    const total = Math.max(0, Number.parseInt(totalSamples, 10) || 0);
    const max = normalizeTrayCapacity(maxPerTray, 1);
    return Math.max(1, Math.ceil(Math.max(total, 1) / max));
  };
  const getTrayColorHue = (index) => {
    const safe = Math.max(0, Number.parseInt(index, 10) || 0);
    return (safe * 61 + 160) % 360;
  };
  const uniqList = (values) => {
    const output = [];
    const seen = new Set();
    (Array.isArray(values) ? values : []).forEach((item) => {
      const value = String(item || "").trim();
      if (!value || seen.has(value)) {
        return;
      }
      seen.add(value);
      output.push(value);
    });
    return output;
  };
  const syncTextareaHeight = (textarea) => {
    if (!textarea) {
      return;
    }
    const lineCount = Math.max(1, String(textarea.value || "").split(/\r?\n/).length);
    textarea.rows = Math.max(3, lineCount);
    textarea.style.height = "auto";
    textarea.style.height = `${textarea.scrollHeight}px`;
  };

  const buildTrayPlanError = (errors, invalidCodes = []) => {
    const messages = [];
    if (Array.isArray(errors) && errors.length) {
      messages.push(...errors.map((message) => `[格式错误] ${message}`));
    }
    const uniqueInvalid = Array.from(new Set((Array.isArray(invalidCodes) ? invalidCodes : []).filter(Boolean)));
    if (uniqueInvalid.length) {
      messages.push(`[编号错误] 不属于当前任务样品：${uniqueInvalid.join("、")}`);
    }
    return messages.join("\n");
  };

  const parseTrayPlanToDraft = (rawPlan, taskCode) => {
    const { entries, errors } = parseSampleTrayPlan(rawPlan);
    const allowedSet = new Set(trayDraft.sampleCodes);
    const invalidCodes = [];
    const trayMap = new Map();
    entries.forEach((entry, index) => {
      const sampleCode = (entry.sampleCode || "").trim();
      if (!sampleCode || !allowedSet.has(sampleCode)) {
        if (sampleCode) {
          invalidCodes.push(sampleCode);
        }
        return;
      }
      const trayKey = (entry.trayCode || "").trim() || `TMP-${index + 1}`;
      if (!trayMap.has(trayKey)) {
        trayMap.set(trayKey, {
          id: nextTrayId(),
          trayCode: trayKey,
          capacity: 1,
          samples: [],
        });
      }
      const tray = trayMap.get(trayKey);
      if (!tray.samples.includes(sampleCode)) {
        tray.samples.push(sampleCode);
      }
      tray.capacity = Math.max(tray.capacity, tray.samples.length);
    });
    const error = buildTrayPlanError(errors, invalidCodes);
    if (error) {
      return { trays: [], error };
    }
    const trays = Array.from(trayMap.values()).sort((left, right) => compareSampleCode(left.trayCode, right.trayCode));
    trays.forEach((tray, index) => {
      tray.trayCode = buildTaskTrayCode(taskCode, index + 1) || tray.trayCode;
    });
    return {
      trays,
      error: "",
    };
  };

  const normalizeTrays = (rawTrays, taskCode) => {
    const allowedSet = new Set(trayDraft.sampleCodes);
    const assigned = new Set();
    const normalized = [];
    const sourceTrays = Array.isArray(rawTrays) ? rawTrays : [];
    const maxPerTray = normalizeTrayCapacity(trayDraft.maxPerTray, 1);
    const overflow = [];

    sourceTrays.forEach((rawTray) => {
      const traySamples = [];
      uniqList(rawTray?.samples || []).forEach((sampleCode) => {
        if (!allowedSet.has(sampleCode) || assigned.has(sampleCode)) {
          return;
        }
        assigned.add(sampleCode);
        traySamples.push(sampleCode);
      });
      if (!traySamples.length && sourceTrays.length > 1) {
        return;
      }
      while (traySamples.length > maxPerTray) {
        const removed = traySamples.pop();
        if (removed) {
          assigned.delete(removed);
          overflow.unshift(removed);
        }
      }
      traySamples.sort(compareSampleCode);
      normalized.push({
        id: rawTray?.id || nextTrayId(),
        trayCode: (rawTray?.trayCode || "").trim(),
        capacity: maxPerTray,
        samples: traySamples,
      });
    });

    const unassigned = trayDraft.sampleCodes.filter((sampleCode) => !assigned.has(sampleCode)).concat(overflow);
    unassigned.forEach((sampleCode) => {
      const target = normalized.find((tray) => tray.samples.length < maxPerTray);
      if (target) {
        target.samples.push(sampleCode);
        return;
      }
      normalized.push({
        id: nextTrayId(),
        trayCode: "",
        capacity: maxPerTray,
        samples: [sampleCode],
      });
    });

    if (normalized.length === 0 && trayDraft.sampleCodes.length > 0) {
      normalized.push({
        id: nextTrayId(),
        trayCode: "",
        capacity: maxPerTray,
        samples: trayDraft.sampleCodes.slice(0, maxPerTray),
      });
      trayDraft.sampleCodes.slice(maxPerTray).forEach((sampleCode) => {
        normalized.push({
          id: nextTrayId(),
          trayCode: "",
          capacity: maxPerTray,
          samples: [sampleCode],
        });
      });
    }

    normalized.forEach((tray) => {
      tray.samples = tray.samples.slice().sort(compareSampleCode);
    });
    normalized.sort((left, right) => {
      const leftKey = left.samples[0] || "";
      const rightKey = right.samples[0] || "";
      if (!leftKey && !rightKey) {
        return 0;
      }
      if (!leftKey) {
        return 1;
      }
      if (!rightKey) {
        return -1;
      }
      return compareSampleCode(leftKey, rightKey);
    });

    normalized.forEach((tray, index) => {
      tray.trayCode =
        buildTaskTrayCode(taskCode, index + 1) || tray.trayCode || `TRAY-${String(index + 1).padStart(3, "0")}`;
      tray.capacity = maxPerTray;
    });

    return normalized;
  };

  const buildDraftFromSamples = (taskSamples) => {
    const allowedSet = new Set(trayDraft.sampleCodes);
    const trayMap = new Map();
    (Array.isArray(taskSamples) ? taskSamples : []).forEach((sample) => {
      const sampleCode = (sample?.code || "").trim();
      if (!sampleCode || !allowedSet.has(sampleCode)) {
        return;
      }
      getSampleTrayList(sample).forEach((tray, index) => {
        const key = (tray.tray_code || "").trim() || `AUTO-${sampleCode}-${index + 1}`;
        if (!trayMap.has(key)) {
          trayMap.set(key, {
            id: nextTrayId(),
            trayCode: key,
            capacity: normalizeTrayCapacity(trayDraft.maxPerTray, 1),
            samples: [],
          });
        }
        const target = trayMap.get(key);
        if (!target.samples.includes(sampleCode)) {
          target.samples.push(sampleCode);
        }
      });
    });
    return Array.from(trayMap.values());
  };

  const syncTrayPreview = (errorMessage = "") => {
    if (!trayPreviewInput) {
      return;
    }
    if (errorMessage) {
      trayPreviewInput.value = errorMessage;
      syncTextareaHeight(trayPreviewInput);
      return;
    }
    const lines = trayDraft.trays.map((tray) => {
      const sampleText = tray.samples.length ? tray.samples.join("、") : "未分配样品";
      return `${tray.trayCode} | ${tray.samples.length} / ${tray.capacity} | ${sampleText}`;
    });
    trayPreviewInput.value = lines.join("\n");
    syncTextareaHeight(trayPreviewInput);
  };

  const syncTrayPlanFromDraft = () => {
    if (!trayPlanInput) {
      syncTrayPreview("");
      return;
    }
    const lines = [];
    trayDraft.trays.forEach((tray) => {
      tray.samples.forEach((sampleCode) => {
        lines.push(`${sampleCode},1,${tray.trayCode}`);
      });
    });
    trayPlanInput.value = lines.join("\n");
    trayPlanInput.dataset.taskCode = trayDraft.taskCode;
    syncTextareaHeight(trayPlanInput);
    syncTrayPreview("");
  };

  const setTrayDraft = (trays, taskCode) => {
    trayDraft.trays = normalizeTrays(trays, taskCode);
    if (trayDraft.trays.length === 0) {
      trayDraft.activeIndex = -1;
      return;
    }
    if (trayDraft.activeIndex < 0 || trayDraft.activeIndex >= trayDraft.trays.length) {
      trayDraft.activeIndex = 0;
    }
  };

  const applyUnifiedLimit = (nextLimit) => {
    const normalizedLimit = normalizeTrayCapacity(nextLimit, trayDraft.maxPerTray || 1);
    trayDraft.maxPerTray = normalizedLimit;
    const requiredTrayCount = getRequiredTrayCount(trayDraft.sampleCodes.length, trayDraft.maxPerTray);
    rebalanceEvenly(requiredTrayCount);
    if (trayDraft.activeIndex >= trayDraft.trays.length) {
      trayDraft.activeIndex = trayDraft.trays.length - 1;
    }
    if (trayLimitInput) {
      trayLimitInput.value = String(trayDraft.maxPerTray);
    }
  };

  const moveSampleToTray = (sampleCode, targetIndex) => {
    const code = (sampleCode || "").trim();
    if (!code || !trayDraft.sampleCodes.includes(code)) {
      return false;
    }
    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= trayDraft.trays.length) {
      return false;
    }
    const target = trayDraft.trays[targetIndex];
    const currentIndex = trayDraft.trays.findIndex((tray) => tray.samples.includes(code));
    if (currentIndex === targetIndex) {
      return true;
    }
    if (target.samples.length >= trayDraft.maxPerTray) {
      return false;
    }
    if (currentIndex >= 0) {
      trayDraft.trays[currentIndex].samples = trayDraft.trays[currentIndex].samples.filter((item) => item !== code);
    }
    target.samples.push(code);
    target.samples = uniqList(target.samples);
    trayDraft.trays = normalizeTrays(trayDraft.trays, trayDraft.taskCode);
    return true;
  };

  const placeOverflow = (overflowSamples, startIndex = 0) => {
    const overflow = uniqList(overflowSamples);
    overflow.forEach((sampleCode) => {
      let placed = false;
      for (let offset = 0; offset < trayDraft.trays.length; offset += 1) {
        const index = (startIndex + offset) % trayDraft.trays.length;
        const tray = trayDraft.trays[index];
        if (tray.samples.length < trayDraft.maxPerTray) {
          tray.samples.push(sampleCode);
          placed = true;
          break;
        }
      }
      if (!placed) {
        trayDraft.trays.push({
          id: nextTrayId(),
          trayCode: "",
          capacity: trayDraft.maxPerTray,
          samples: [sampleCode],
        });
      }
    });
    trayDraft.trays = normalizeTrays(trayDraft.trays, trayDraft.taskCode);
  };

  const rebalanceEvenly = (trayCount) => {
    const requested = Math.max(1, Number.parseInt(trayCount, 10) || 1);
    const allCodes = trayDraft.sampleCodes.slice().sort(compareSampleCode);
    const required = getRequiredTrayCount(allCodes.length, trayDraft.maxPerTray);
    const count = Math.max(requested, required);
    const trays = [];
    const baseSize = count > 0 ? Math.floor(allCodes.length / count) : 0;
    const remainder = count > 0 ? allCodes.length % count : 0;
    let cursor = 0;
    for (let index = 0; index < count; index += 1) {
      const take = baseSize + (index < remainder ? 1 : 0);
      const samples = allCodes.slice(cursor, cursor + take);
      cursor += take;
      trays.push({
        id: nextTrayId(),
        trayCode: "",
        capacity: trayDraft.maxPerTray,
        samples,
      });
    }
    trayDraft.trays = normalizeTrays(trays, trayDraft.taskCode);
    trayDraft.activeIndex = Math.min(count - 1, trayDraft.trays.length - 1);
  };

  const removeTrayAt = (index) => {
    if (!Number.isFinite(index) || index < 0 || index >= trayDraft.trays.length) {
      return;
    }
    if (trayDraft.trays.length <= 1) {
      return;
    }
    const overflow = trayDraft.trays[index].samples.slice();
    trayDraft.trays.splice(index, 1);
    placeOverflow(overflow, index);
    if (trayDraft.activeIndex >= trayDraft.trays.length) {
      trayDraft.activeIndex = trayDraft.trays.length - 1;
    }
  };

  const getSampleOwner = (sampleCode) =>
    trayDraft.trays.findIndex((tray) => tray.samples.includes(sampleCode));

  const renderTraySource = () => {
    if (!traySource) {
      return;
    }
    const hasActiveTray = trayDraft.activeIndex >= 0 && trayDraft.activeIndex < trayDraft.trays.length;
    if (traySourcePanel) {
      traySourcePanel.classList.toggle("has-active-tray", hasActiveTray);
    }
    if (traySourceHint) {
      if (hasActiveTray) {
        const activeTray = trayDraft.trays[trayDraft.activeIndex];
        traySourceHint.textContent = `当前托盘：${activeTray?.trayCode || `托盘 #${trayDraft.activeIndex + 1}`}（可拖拽样品到此托盘）`;
      } else {
        traySourceHint.textContent = "当前未选中托盘（点击托盘可聚焦，点击左侧空白可取消）";
      }
    }
    traySource.innerHTML = "";
    if (!trayDraft.sampleCodes.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "当前任务暂无样品编号";
      traySource.appendChild(empty);
      return;
    }
    trayDraft.sampleCodes.forEach((sampleCode) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "sample-tray-chip";
      chip.draggable = true;
      chip.dataset.sampleCode = sampleCode;
      chip.textContent = sampleCode;
      const ownerIndex = getSampleOwner(sampleCode);
      chip.classList.toggle("is-active", ownerIndex === trayDraft.activeIndex);
      chip.classList.toggle("is-assigned", ownerIndex >= 0);
      chip.classList.toggle("is-target", ownerIndex === trayDraft.activeIndex && hasActiveTray);
      chip.classList.toggle("is-dim", hasActiveTray && ownerIndex !== trayDraft.activeIndex);
      if (ownerIndex >= 0) {
        chip.style.setProperty("--tray-hue", String(getTrayColorHue(ownerIndex)));
      } else {
        chip.style.removeProperty("--tray-hue");
      }
      chip.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData("text/plain", sampleCode);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
        }
      });
      traySource.appendChild(chip);
    });
  };

  const renderTrayList = () => {
    if (!trayList) {
      return;
    }
    trayList.innerHTML = "";
    if (!trayDraft.trays.length) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "点击“新增托盘”后，可拖动样品到托盘。";
      trayList.appendChild(empty);
      return;
    }
    const displayTrays = trayDraft.trays;
    displayTrays.forEach((tray, index) => {
      const card = document.createElement("div");
      card.className = "sample-tray-card";
      card.dataset.trayIndex = String(index);
      card.classList.toggle("is-active", index === trayDraft.activeIndex);
      card.addEventListener("click", () => {
        trayDraft.activeIndex = trayDraft.activeIndex === index ? -1 : index;
        renderTraySource();
        renderTrayList();
      });
      card.addEventListener("dragover", (event) => {
        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        card.classList.add("is-drag-over");
      });
      card.addEventListener("dragleave", () => {
        card.classList.remove("is-drag-over");
      });
      card.addEventListener("drop", (event) => {
        event.preventDefault();
        card.classList.remove("is-drag-over");
        const droppedCode = (event.dataTransfer?.getData("text/plain") || "").trim();
        if (!droppedCode) {
          return;
        }
        if (!moveSampleToTray(droppedCode, index)) {
          return;
        }
        trayDraft.activeIndex = index;
        renderTraySource();
        renderTrayList();
        syncTrayPlanFromDraft();
      });

      const head = document.createElement("div");
      head.className = "sample-tray-card-head";
      const title = document.createElement("span");
      title.textContent = tray.trayCode || "未编号托盘";
      const order = document.createElement("span");
      order.textContent = `托盘 #${index + 1}`;
      head.appendChild(title);
      head.appendChild(order);
      card.appendChild(head);

      const meta = document.createElement("div");
      meta.className = "sample-tray-card-meta";
      meta.textContent = `已放置 ${tray.samples.length} / ${trayDraft.maxPerTray}`;
      card.appendChild(meta);

      const sampleWrap = document.createElement("div");
      sampleWrap.className = "sample-tray-samples";
      if (!tray.samples.length) {
        const empty = document.createElement("span");
        empty.className = "sample-tray-empty";
        empty.textContent = "未分配样品";
        sampleWrap.appendChild(empty);
      } else {
        tray.samples.forEach((sampleCode) => {
          const tag = document.createElement("button");
          tag.type = "button";
          tag.className = "sample-tray-sample-tag";
          tag.draggable = true;
          tag.dataset.sampleCode = sampleCode;
          tag.textContent = sampleCode;
          tag.title = "拖拽到其他托盘";
          tag.addEventListener("dragstart", (event) => {
            event.stopPropagation();
            event.dataTransfer?.setData("text/plain", sampleCode);
            if (event.dataTransfer) {
              event.dataTransfer.effectAllowed = "move";
            }
          });
          sampleWrap.appendChild(tag);
        });
      }
      card.appendChild(sampleWrap);

      const controls = document.createElement("div");
      controls.className = "sample-tray-card-controls";

      const capacityWrap = document.createElement("label");
      capacityWrap.className = "sample-tray-capacity";
      capacityWrap.textContent = `数量（当前放置样品数）：${tray.samples.length}`;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "sample-tray-remove";
      removeBtn.textContent = "删除";
      removeBtn.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        removeTrayAt(index);
        renderTraySource();
        renderTrayList();
        syncTrayPlanFromDraft();
      });

      controls.appendChild(capacityWrap);
      controls.appendChild(removeBtn);
      card.appendChild(controls);
      trayList.appendChild(card);
    });
  };

  const renderTrayBuilder = () => {
    renderTraySource();
    renderTrayList();
    if (trayLimitInput) {
      trayLimitInput.value = String(Math.max(1, trayDraft.maxPerTray || 1));
      trayLimitInput.disabled = !trayDraft.taskCode || trayDraft.sampleCodes.length === 0;
    }
    if (trayAddBtn) {
      trayAddBtn.disabled = !trayDraft.taskCode || trayDraft.sampleCodes.length === 0;
    }
  };

  const handleTrayPlanInput = () => {
    if (!trayPlanInput || !trayDraft.taskCode) {
      return;
    }
    const parsed = parseTrayPlanToDraft(trayPlanInput.value, trayDraft.taskCode);
    if (parsed.error) {
      syncTrayPreview(parsed.error);
      syncTextareaHeight(trayPlanInput);
      return;
    }
    trayDraft.maxPerTray = Math.max(
      normalizeTrayCapacity(trayDraft.maxPerTray, 1),
      ...parsed.trays.map((item) => (Array.isArray(item.samples) ? item.samples.length : 0))
    );
    setTrayDraft(parsed.trays, trayDraft.taskCode);
    renderTrayBuilder();
    syncTrayPlanFromDraft();
  };

  const updateCount = () => {
    const code = (select.value || "").trim();
    if (!code) {
      countEl.textContent = "0";
      if (countHintEl) {
        countHintEl.textContent = "请选择任务后查看样品数量与样品编号。";
      }
      if (codesInput) {
        codesInput.value = "";
        syncTextareaHeight(codesInput);
      }
      if (trayPlanInput) {
        trayPlanInput.dataset.taskCode = "";
        trayPlanInput.value = "";
        syncTextareaHeight(trayPlanInput);
      }
      if (trayPreviewInput) {
        trayPreviewInput.value = "";
        syncTextareaHeight(trayPreviewInput);
      }
      trayDraft.taskCode = "";
      trayDraft.sampleCodes = [];
      trayDraft.maxPerTray = DEFAULT_TRAY_LIMIT;
      trayDraft.trays = [{ id: nextTrayId(), trayCode: "", capacity: DEFAULT_TRAY_LIMIT, samples: [] }];
      trayDraft.activeIndex = -1;
      renderTrayBuilder();
      if (storeBtn) {
        storeBtn.disabled = true;
        storeBtn.dataset.taskCode = "";
      }
      if (printBtn) {
        printBtn.disabled = true;
        printBtn.dataset.taskCode = "";
        printBtn.dataset.trayCodes = "";
      }
      renderUnifiedSampleFlow(-1);
      return;
    }

    const task = tasks.find((item) => item.code === code);
    const taskSamples = sampleList.filter((sample) => (sample.task_code || "").trim() === code);
    const sampleCodes = taskSamples.map((sample) => (sample.code || "").trim()).filter(Boolean);
    const sampleTrayCodes = Array.from(
      new Set(
        taskSamples
          .flatMap((sample) => getSampleTrayList(sample))
          .map((tray) => (tray.tray_code || "").trim())
          .filter(Boolean)
      )
    );
    const taskTrayCodes = Array.isArray(task?.tray_codes)
      ? task.tray_codes.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const trayCount = Math.max(sampleTrayCodes.length, taskTrayCodes.length);

    const rawCount = task?.sample_count ?? "";
    const plannedCount = rawCount !== "" && Number.isFinite(Number(rawCount)) ? Number(rawCount) : NaN;
    const autoCodes = buildTaskSampleCodes(code, plannedCount, taskSamples);
    if (Number.isFinite(plannedCount)) {
      countEl.textContent = String(plannedCount);
      if (countHintEl) {
        countHintEl.textContent = `计划 ${plannedCount}，已登记 ${sampleCodes.length}，已分装托盘 ${trayCount}。`;
      }
    } else {
      countEl.textContent = String(sampleCodes.length);
      if (countHintEl) {
        countHintEl.textContent = `该任务已登记 ${sampleCodes.length} 个样品，已分装托盘 ${trayCount}。`;
      }
    }

    if (codesInput) {
      codesInput.value = autoCodes.join("\n");
      syncTextareaHeight(codesInput);
    }

    trayDraft.taskCode = code;
    trayDraft.sampleCodes = autoCodes.slice();

    const previousTaskCode = trayPlanInput?.dataset.taskCode || "";
    trayDraft.maxPerTray = DEFAULT_TRAY_LIMIT;
    if (trayPlanInput) {
      if (previousTaskCode !== code) {
        trayPlanInput.value = "";
      }
      trayPlanInput.dataset.taskCode = code;
      syncTextareaHeight(trayPlanInput);
    }

    const rawPlan = (trayPlanInput?.value || "").trim();
    let parsedError = "";
    if (rawPlan) {
      const parsed = parseTrayPlanToDraft(rawPlan, code);
      if (parsed.error) {
        parsedError = parsed.error;
        const fromSamples = buildDraftFromSamples(taskSamples);
        if (fromSamples.length) {
          setTrayDraft(fromSamples, code);
        } else {
          const defaultTrayCount = autoCodes.length > DEFAULT_TRAY_LIMIT ? DEFAULT_TRAY_COUNT : 1;
          rebalanceEvenly(defaultTrayCount);
        }
      } else {
        setTrayDraft(parsed.trays, code);
      }
    } else {
      const fromSamples = buildDraftFromSamples(taskSamples);
      if (fromSamples.length) {
        setTrayDraft(fromSamples, code);
      } else {
        const defaultTrayCount = autoCodes.length > DEFAULT_TRAY_LIMIT ? DEFAULT_TRAY_COUNT : 1;
        rebalanceEvenly(defaultTrayCount);
      }
    }
    renderTrayBuilder();
    if (parsedError) {
      syncTrayPreview(parsedError);
      if (trayPlanInput) {
        syncTextareaHeight(trayPlanInput);
      }
    } else {
      syncTrayPlanFromDraft();
    }

    if (storeBtn) {
      storeBtn.disabled = autoCodes.length === 0;
      storeBtn.dataset.taskCode = code;
    }
    if (printBtn) {
      const trayCodes = Array.from(new Set(sampleTrayCodes.concat(taskTrayCodes))).sort(compareSampleCode);
      const hasConfirmedTray = trayCodes.length > 0;
      printBtn.disabled = !hasConfirmedTray;
      printBtn.dataset.taskCode = code;
      printBtn.dataset.trayCodes = trayCodes.join(",");
    }
    const taskStage = taskSamples.length
      ? taskSamples.reduce((maxStage, sample) => Math.max(maxStage, resolveSampleFlowStageIndex(sample, labels)), 0)
      : 0;
    renderUnifiedSampleFlow(taskStage);
  };

  select.onchange = updateCount;
  if (traySourcePanel) {
    traySourcePanel.onclick = (event) => {
      if (event.target?.closest?.(".sample-tray-chip")) {
        return;
      }
      trayDraft.activeIndex = -1;
      renderTraySource();
      renderTrayList();
    };
  }
  if (trayPlanInput) {
    trayPlanInput.oninput = handleTrayPlanInput;
  }
  if (trayLimitInput) {
    trayLimitInput.onchange = () => {
      if (!trayDraft.taskCode || trayDraft.sampleCodes.length === 0) {
        return;
      }
      applyUnifiedLimit(trayLimitInput.value);
      renderTrayBuilder();
      syncTrayPlanFromDraft();
    };
  }
  if (trayAddBtn) {
    trayAddBtn.onclick = (event) => {
      event.preventDefault();
      if (!trayDraft.taskCode || trayDraft.sampleCodes.length === 0) {
        return;
      }
      rebalanceEvenly(trayDraft.trays.length + 1);
      renderTrayBuilder();
      syncTrayPlanFromDraft();
    };
  }

  updateCount();
}

function renderSamplesPage(labels) {
  const tbody = document.getElementById("sample-table-body");
  if (!tbody) {
    return;
  }
  const pagination = document.getElementById("sample-list-pagination");
  const searchInput = document.getElementById("sample-list-search");
  const taskFilter = document.getElementById("sample-list-filter-task");
  const statusFilter = document.getElementById("sample-list-filter-status");
  let samples = loadStore(STORAGE_KEYS.samples, []);
  if (!Array.isArray(samples)) {
    samples = [];
  }

  let tasks = loadStore(STORAGE_KEYS.tasks, []);
  let schedules = loadStore(STORAGE_KEYS.schedules, []);
  if (!Array.isArray(tasks)) {
    tasks = [];
  }
  if (!Array.isArray(schedules)) {
    schedules = [];
  }
  const sampleTasks = buildSampleTaskList(tasks, samples, schedules);
  if (taskFilter) {
    const previousValue = taskFilter.value;
    const codes = Array.from(
      new Set(
        sampleTasks
          .map((task) => (task?.code || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    taskFilter.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "全部任务";
    taskFilter.appendChild(defaultOption);
    codes.forEach((code) => {
      const option = document.createElement("option");
      option.value = code;
      option.textContent = code;
      taskFilter.appendChild(option);
    });
    if (previousValue && codes.includes(previousValue)) {
      taskFilter.value = previousValue;
    }
  }
  if (statusFilter) {
    const previousValue = statusFilter.value;
    const statuses = Array.from(
      new Set(
        samples
          .map((sample) => (sample?.status || "").trim())
          .filter(Boolean)
      )
    );
    statusFilter.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = "全部状态";
    statusFilter.appendChild(defaultOption);
    statuses.forEach((status) => {
      const option = document.createElement("option");
      option.value = status;
      option.textContent = status;
      statusFilter.appendChild(option);
    });
    if (previousValue && statuses.includes(previousValue)) {
      statusFilter.value = previousValue;
    }
  }

  const query = (searchInput?.value || "").trim().toLowerCase();
  const selectedTask = (taskFilter?.value || "").trim();
  const selectedStatus = (statusFilter?.value || "").trim();
  const filteredSamples = samples.filter((sample) => {
    if (selectedTask && (sample.task_code || "") !== selectedTask) {
      return false;
    }
    if (selectedStatus && (sample.status || "") !== selectedStatus) {
      return false;
    }
    if (!query) {
      return true;
    }
    const trayList = getSampleTrayList(sample);
    const searchText = [
      sample.task_code || "",
      sample.code || "",
      trayList.map((tray) => tray.tray_code).join(" "),
      sample.location || "",
      sample.owner || "",
      sample.status || "",
      sample.flow_status || "",
    ]
      .join(" ")
      .toLowerCase();
    return searchText.includes(query);
  });

  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(filteredSamples.length / pageSize));
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
  const pageItems = filteredSamples.slice(startIndex, startIndex + pageSize);

  tbody.innerHTML = "";
  pageItems.forEach((sample, index) => {
    const serial = startIndex + index + 1;
    const trayCount = getSampleTrayList(sample).length;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${serial}</td>
      <td>${sample.task_code || ""}</td>
      <td>${sample.code || ""}</td>
      <td>${trayCount}</td>
      <td>${sample.location || ""}</td>
      <td>${sample.owner || ""}</td>
      <td><span class="${statusClass(sample.status, labels)}">${sample.status || ""}</span></td>
      <td><a class="action-link" href="#" data-drawer-open="sample-drawer">${labels.edit}</a></td>
    `;
    tbody.appendChild(row);
  });

  const bindSampleFilters = (element, eventName) => {
    if (!element || element.dataset.bound === "1") {
      return;
    }
    element.addEventListener(eventName, () => {
      if (pagination) {
        pagination.dataset.page = "1";
      }
      renderSamplesPage(labels);
    });
    element.dataset.bound = "1";
  };
  bindSampleFilters(searchInput, "input");
  bindSampleFilters(taskFilter, "change");
  bindSampleFilters(statusFilter, "change");

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
          renderSamplesPage(labels);
        });
        pagination.dataset.bound = "1";
      }
    }
  }

  fillSampleTaskSelects(sampleTasks);
  renderSampleTaskSummary(sampleTasks, samples, labels);
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
  computed.forEach((device, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
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
  let tasks = loadStore(STORAGE_KEYS.tasks, []);
  if (!Array.isArray(schedules)) {
    schedules = [];
  }
  if (!Array.isArray(devices)) {
    devices = [];
  }
  if (!Array.isArray(tasks)) {
    tasks = [];
  }
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
  const { resolveTaskStatus } = createTaskStatusResolver(tasks, schedules, labels, new Date());
  let taskStatusUpdated = false;
  tasks.forEach((task) => {
    const nextStatus = resolveTaskStatus(task, task.status || "");
    if (nextStatus && nextStatus !== task.status) {
      task.status = nextStatus;
      taskStatusUpdated = true;
    }
  });
  if (taskStatusUpdated) {
    saveStore(STORAGE_KEYS.tasks, tasks);
  }
  const computed = schedules.map((entry) => {
    const status = resolveTaskStatus(entry.task_code, entry.status || "");
    return { ...entry, status };
  });

  tbody.innerHTML = "";
  computed.forEach((entry, index) => {
    const row = document.createElement("tr");
    if (entry.id) {
      row.dataset.scheduleId = entry.id;
    }
    row.innerHTML = `
      <td>${index + 1}</td>
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
    conflicts.forEach((item, index) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${index + 1}</td>
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
  streams.forEach((stream, index) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${index + 1}</td>
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

  const { resolveTaskStatus, retentionStatus, runningStatus } = createTaskStatusResolver(
    tasks,
    schedules,
    labels,
    new Date()
  );
  let taskStatusUpdated = false;

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
  const retentionCount = tasks.filter((t) => t.status === retentionStatus || t.status === labels.statusRetention).length;
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
  pageItems.forEach((task, index) => {
    const serial = startIndex + index + 1;
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${serial}</td>
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
