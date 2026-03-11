function compareText(left, right) {
  return String(left || "").localeCompare(String(right || ""), "zh-Hans-CN");
}

function normalizeQuantity(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function buildTaskRows({
  tasks,
  samples,
  schedules,
  scheduledLabel,
  unscheduledLabel,
}) {
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

  return Array.from(taskMap.values())
    .map((row) => {
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

      const scheduleLabel = row.scheduleCount > 0 ? scheduledLabel : unscheduledLabel;
      const currentStatus = row.taskStatus || scheduleLabel;

      return {
        ...row,
        currentStatus,
        scheduleLabel,
        sampleCodes: uniqueSampleCodes,
        sampleCount: uniqueSampleCodes.length,
        trays,
      };
    })
    .sort((left, right) => compareText(left.taskCode, right.taskCode));
}

function buildTrayOverviewRows({
  tasks,
  samples,
  schedules,
  totalSlots,
  scheduledLabel,
  unscheduledLabel,
  unassignedExperimentLabel,
}) {
  const taskList = Array.isArray(tasks) ? tasks : [];
  const sampleList = Array.isArray(samples) ? samples : [];
  const scheduleList = Array.isArray(schedules) ? schedules : [];

  const taskTypeByCode = new Map();
  taskList.forEach((task) => {
    const code = String(task?.code || "").trim();
    if (!code) {
      return;
    }
    taskTypeByCode.set(code, String(task?.test_type || task?.name || "").trim());
  });

  const scheduleByTaskCode = new Map();
  scheduleList.forEach((entry) => {
    const taskCode = String(entry?.task_code || "").trim();
    if (!taskCode) {
      return;
    }
    const device = String(entry?.device || "").trim();
    const ts = Date.parse(String(entry?.start_at || entry?.created_at || ""));
    const current = scheduleByTaskCode.get(taskCode);
    const next = { device, ts: Number.isFinite(ts) ? ts : -1 };
    if (!current || next.ts >= current.ts) {
      scheduleByTaskCode.set(taskCode, next);
    }
  });

  const trayMap = new Map();
  sampleList.forEach((sample) => {
    const taskCode = String(sample?.task_code || "").trim();
    if (!taskCode) {
      return;
    }
    const targetExperiment = taskTypeByCode.get(taskCode) || "-";
    const scheduleInfo = scheduleByTaskCode.get(taskCode);
    const isScheduled = Boolean(scheduleInfo);
    const scheduleStatus = isScheduled ? scheduledLabel : unscheduledLabel;
    const lab = scheduleInfo?.device || "";

    (Array.isArray(sample?.trays) ? sample.trays : []).forEach((tray) => {
      const trayCode = String(tray?.tray_code || "").trim();
      if (!trayCode || trayMap.has(trayCode)) {
        return;
      }
      trayMap.set(trayCode, {
        trayCode,
        taskCode,
        targetExperiment,
        isScheduled,
        scheduleStatus,
        lab: isScheduled ? lab || "-" : "-",
      });
    });
  });

  const existingTrays = Array.from(trayMap.values())
    .sort((left, right) => compareText(left.trayCode, right.trayCode))
    .slice(0, totalSlots);

  return Array.from({ length: totalSlots }, (_, index) => {
    const slotCode = `TP-${String(index + 1).padStart(3, "0")}`;
    const tray = existingTrays[index];
    if (tray) {
      return {
        slotCode,
        trayCode: tray.trayCode,
        taskCode: tray.taskCode || "-",
        targetExperiment: tray.targetExperiment || "-",
        isScheduled: tray.isScheduled,
        scheduleStatus: tray.scheduleStatus,
        lab: tray.lab || "-",
      };
    }
    return {
      slotCode,
      trayCode: slotCode,
      taskCode: "-",
      targetExperiment: unassignedExperimentLabel,
      isScheduled: false,
      scheduleStatus: unscheduledLabel,
      lab: "-",
    };
  });
}

export { buildTaskRows, buildTrayOverviewRows };
