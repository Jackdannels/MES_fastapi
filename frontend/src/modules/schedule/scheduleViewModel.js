import { TEST_LABS } from "@/lib/labs.js";
import { normalizeAxisCodes } from "@/lib/axisCodes";
import { formatLocalDateTime } from "@/lib/dateTime";
import { serverNowDate } from "@/lib/serverClock";
import { resolveLabRef, resolveScheduleLabCode, scheduleMatchesLab } from "@/lib/labIdentity";
import { resolveTransferConfirmedAt } from "@/lib/transferArrivalTime";
import {
  SLOT_RANGES,
  addDays,
  formatDateTime,
  getSlotState,
  isRetentionDevice,
  normalizeText,
  overlaps,
  parseDate,
  toLocalDateValue,
  toLocalTimeValue,
} from "./sharedModel";
import {
  STATUS_RUNNING,
  STATUS_WAITING,
  buildActiveTaskContext,
  buildExperimentCandidates,
  buildExperimentLabel,
  completedAxisCodesForExperiment,
  experimentSupportsAxisScheduling,
  filterSchedulesForActiveTasks,
  formatAxisLabel,
  isTerminalExperimentStatus,
  resolveExperimentAxisCodes,
  resolveMaintenanceConflictSlotMeta,
  resolveScheduleMaintenanceSlotMeta,
  resolveSubExperimentCode,
  resolveUnavailableSlotMeta,
  scheduledAxisCodesForExperiment,
} from "./scheduleFoundationModel";
import {
  SLOT_SEQUENCE,
  buildExperimentNameMap,
  buildExperimentTrayMap,
  buildSelectedTaskLabSet,
  buildSlotTaskItems,
  buildTrayExperimentCodeMap,
  collectGanttScheduleIds,
  formatOverlapRange,
  formatTraySummary,
  getMasterLabName,
  getMasterLabNames,
  hasScheduleOverlap,
  mergeGanttItems,
  resolveExperimentTypeLabel,
  resolveLabCandidates,
  resolveScheduleLifecycleState,
  resolveScheduleRowStatus,
  resolveTaskColor,
  resolveTaskStatus,
  scheduleIsCompleted,
  sortTextList,
  statusClass,
  taskHasSavedTrayPlan,
} from "./scheduleLifecycleModel";
import { resolveScheduleDelayPresentation } from "./scheduleDelayPresentation";


function buildTaskScheduledOverlays({ taskCode, experimentCode, schedules, experiments, experimentTrays, tasks = [], samples = [] }) {
  const normalizedTaskCode = normalizeText(taskCode);
  const selectedExperimentCode = normalizeText(experimentCode);
  if (!normalizedTaskCode) {
    return [];
  }
  const { activeTaskCodes } = buildActiveTaskContext(tasks, samples);
  if (activeTaskCodes && !activeTaskCodes.has(normalizedTaskCode)) {
    return [];
  }

  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayMap = buildExperimentTrayMap(experimentTrays);

  return filterSchedulesForActiveTasks({ schedules, tasks, samples })
    .filter((schedule) => {
      if (normalizeText(schedule?.task_code) !== normalizedTaskCode) {
        return false;
      }
      if (isRetentionDevice(schedule)) {
        return false;
      }
      if (normalizeText(schedule?.experiment_code) === selectedExperimentCode) {
        return false;
      }
      return true;
    })
    .map((schedule) => {
      const overlayExperimentCode = normalizeText(schedule?.experiment_code);
      const trayNos = sortTextList(trayMap.get(`${normalizedTaskCode}::${overlayExperimentCode}`) || []);
      const startAt = parseDate(schedule?.start_at);
      return {
        device: normalizeText(schedule?.device),
        endAt: normalizeText(schedule?.end_at),
        experimentCode: overlayExperimentCode,
        experimentLabel: experimentNameByCode.get(overlayExperimentCode) || buildExperimentLabel(overlayExperimentCode),
        scheduleId: normalizeText(schedule?.id),
        startAt: normalizeText(schedule?.start_at),
        taskCode: normalizedTaskCode,
        timeLabel: formatOverlapRange(schedule?.start_at, schedule?.end_at),
        trayNos,
        traySummary: formatTraySummary(trayNos),
        sortTime: startAt?.getTime() || Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((left, right) => left.sortTime - right.sortTime)
    .map((overlay) => {
      const nextOverlay = { ...overlay };
      delete nextOverlay.sortTime;
      return nextOverlay;
    });
}

function analyzeTaskTrayConflict({ candidate, schedules, experiments, experimentTrays, samples = [] }) {
  const candidateTaskCode = normalizeText(candidate?.task_code);
  const candidateExperimentCode = normalizeText(candidate?.experiment_code);
  const candidateStart = parseDate(candidate?.start_at);
  const candidateEnd = parseDate(candidate?.end_at);
  if (!candidateTaskCode || !candidateExperimentCode || !candidateStart || !candidateEnd) {
    return null;
  }

  const trayMap = buildExperimentTrayMap(experimentTrays);
  const candidateTrayNos = sortTextList(trayMap.get(`${candidateTaskCode}::${candidateExperimentCode}`) || []);
  if (candidateTrayNos.length === 0) {
    return null;
  }

  const candidateTraySet = new Set(candidateTrayNos);
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const conflictSchedules = (Array.isArray(schedules) ? schedules : [])
    .filter((schedule) => {
      if (normalizeText(schedule?.task_code) !== candidateTaskCode) {
        return false;
      }
      if (isRetentionDevice(schedule)) {
        return false;
      }
      if (normalizeText(schedule?.experiment_code) === candidateExperimentCode) {
        return false;
      }
      if (scheduleIsCompleted({ experimentNameByCode, experimentTrayMap: trayMap, samples, schedule, trayExperimentCodeMap })) {
        return false;
      }
      const scheduleStart = parseDate(schedule?.start_at);
      const scheduleEnd = parseDate(schedule?.end_at);
      return scheduleStart && scheduleEnd && overlaps(candidateStart, candidateEnd, scheduleStart, scheduleEnd);
    })
    .map((schedule) => {
      const scheduleExperimentCode = normalizeText(schedule?.experiment_code);
      const trayNos = sortTextList(trayMap.get(`${candidateTaskCode}::${scheduleExperimentCode}`) || []);
      const overlapTrayNos = trayNos.filter((trayNo) => candidateTraySet.has(trayNo));
      if (overlapTrayNos.length === 0) {
        return null;
      }
      const overlapStart = new Date(Math.max(candidateStart.getTime(), parseDate(schedule?.start_at)?.getTime() || 0));
      const overlapEnd = new Date(Math.min(candidateEnd.getTime(), parseDate(schedule?.end_at)?.getTime() || 0));
      return {
        device: normalizeText(schedule?.device),
        experimentCode: scheduleExperimentCode,
        experimentLabel: experimentNameByCode.get(scheduleExperimentCode) || buildExperimentLabel(scheduleExperimentCode),
        overlapRange: formatOverlapRange(overlapStart, overlapEnd),
        scheduleId: normalizeText(schedule?.id),
        trayNos,
        traySummary: formatTraySummary(trayNos),
      };
    })
    .filter(Boolean);

  if (conflictSchedules.length === 0) {
    return null;
  }

  const conflictTrayNos = sortTextList(conflictSchedules.flatMap((schedule) => schedule.trayNos.filter((trayNo) => candidateTraySet.has(trayNo))));
  return {
    candidateExperimentCode,
    candidateExperimentLabel: experimentNameByCode.get(candidateExperimentCode) || buildExperimentLabel(candidateExperimentCode),
    candidateTrayNos,
    conflictSchedules,
    conflictTrayNos,
    level: candidateTrayNos.every((trayNo) => conflictTrayNos.includes(trayNo)) ? "full" : "partial",
    taskCode: candidateTaskCode,
  };
}

// 构建看板页签使用的主排程表格行。
function buildScheduleRows({ schedules, tasks, experiments, samples = [], experimentTrays = [], now = serverNowDate() }) {
  const { activeTasks } = buildActiveTaskContext(tasks, samples);
  const taskList = Array.isArray(tasks) && tasks.length > 0 ? activeTasks : [];
  const taskByCode = new Map(taskList.map((task) => [normalizeText(task?.code), task]));
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const visibleSchedules = filterSchedulesForActiveTasks({ schedules, tasks, samples });

  return visibleSchedules
    .map((schedule) => {
      const taskCode = normalizeText(schedule?.task_code);
      const experimentCode = normalizeText(schedule?.experiment_code);
      const subExperimentCode = resolveSubExperimentCode(schedule);
      const task = taskByCode.get(taskCode);
      // 排程列表的状态按当前这条实验排程的真实生命周期判断，避免同任务下兄弟实验互相串扰。
      const status = resolveScheduleRowStatus({
        schedule,
        samples,
        now,
        experimentTrayMap,
        experimentNameByCode,
        trayExperimentCodeMap,
      });
      const delayPresentation = resolveScheduleDelayPresentation(schedule);

      return {
        axisLabel: normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).map(formatAxisLabel).join(" / "),
        device: normalizeText(schedule?.device),
        delay: delayPresentation,
        delayBadgeLabel: delayPresentation.badgeLabel,
        delayMinutes: delayPresentation.delayMinutes,
        delayReason: delayPresentation.reason,
        endAt: formatDateTime(schedule?.end_at),
        axisCodes: normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes),
        experimentCode,
        experimentLabel: experimentNameByCode.get(experimentCode) || buildExperimentLabel(experimentCode),
        id: normalizeText(schedule?.id),
        rowStatus: status,
        rowStatusClass: statusClass(status),
        scheduleHasDelayConflict: delayPresentation.hasConflict,
        scheduleIsDelayed: delayPresentation.isDelayed,
        startAt: formatDateTime(schedule?.start_at),
        subExperimentCode,
        sub_experiment_code: subExperimentCode,
        taskCode,
        taskName: normalizeText(task?.name),
        testType: normalizeText(task?.test_type),
      };
    })
    .sort((left, right) => left.startAt.localeCompare(right.startAt, "zh-Hans-CN"));
}

// 提取冲突排程对，用于告警条和冲突检查表格。
function buildConflictRows({ schedules, tasks = [], samples = [], experiments = [], experimentTrays = [] }) {
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const scheduleList = filterSchedulesForActiveTasks({ schedules, tasks, samples })
    .filter((schedule) => !isRetentionDevice(schedule))
    .filter(
      (schedule) =>
        !scheduleIsCompleted({
          experimentNameByCode,
          experimentTrayMap,
          samples,
          schedule,
          trayExperimentCodeMap,
        }),
    )
    .map((schedule) => ({ ...schedule }));
  const byDevice = new Map();

  // 冲突检查按设备分组后，只需要比较同设备下相邻时间段是否重叠。
  scheduleList.forEach((schedule) => {
    const device = normalizeText(schedule?.device);
    const labKey = resolveScheduleLabCode(schedule) || device;
    if (!device) {
      return;
    }
    const group = byDevice.get(labKey) || [];
    group.push(schedule);
    byDevice.set(labKey, group);
  });

  const rows = [];
  byDevice.forEach((entries, device) => {
    entries.sort((left, right) => {
      const leftTime = parseDate(left?.start_at)?.getTime() || 0;
      const rightTime = parseDate(right?.start_at)?.getTime() || 0;
      return leftTime - rightTime;
    });

    for (let index = 1; index < entries.length; index += 1) {
      const previous = entries[index - 1];
      const current = entries[index];
      const previousEnd = parseDate(previous?.end_at);
      const currentStart = parseDate(current?.start_at);
      if (!previousEnd || !currentStart || previousEnd <= currentStart) {
        continue;
      }
      rows.push({
        device: normalizeText(current?.device) || device,
        id: normalizeText(current?.id),
        impact: "Delay",
        reason: "Overlap",
        suggestion: "Reschedule",
        taskCode: normalizeText(current?.task_code),
      });
    }
  });

  return rows;
}

// 按设备和时间窗口构建可直接用于甘特图的行数据。
function buildGanttRows({ schedules, experiments = [], experimentTrays = [], samples = [], tasks = [], devices = [], masterLabs = [], days = 3, filterDevice = "", selectedTaskCode = "", startDate = serverNowDate(), now = serverNowDate() }) {
  const experimentTrayMap = buildExperimentTrayMap(experimentTrays);
  const experimentNameByCode = buildExperimentNameMap(experiments);
  const trayExperimentCodeMap = buildTrayExperimentCodeMap(experimentTrays);
  const deviceByCode = new Map((Array.isArray(devices) ? devices : []).map((device) => [normalizeText(device?.code), device]));
  const visibleSchedules = filterSchedulesForActiveTasks({ schedules, tasks, samples }).filter((schedule) => {
    if (isRetentionDevice(schedule)) {
      return false;
    }
    const lifecycleState = resolveScheduleLifecycleState({
      schedule,
      samples,
      experimentTrayMap,
      experimentNameByCode,
      trayExperimentCodeMap,
    });
    // 实验实际完成后立即释放甘特占用，不再等到计划结束时间。
    return !lifecycleState.completed;
  });
  const anchorDate = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  // 如果视图窗口内的默认天数不足以覆盖最新排程，会自动向后扩展。
  const dayList = Array.from({ length: days }, (_, index) => {
    const date = addDays(anchorDate, index);
    return {
      date,
      key: toLocalDateValue(date),
      label: `${date.getMonth() + 1}/${date.getDate()}`,
    };
  });

  const masterLabNames = getMasterLabNames(masterLabs);
  const masterLabByName = new Map(
    (Array.isArray(masterLabs) ? masterLabs : [])
      .map((lab) => {
        const name = getMasterLabName(lab);
        return name ? [name, { ...resolveLabRef(lab), name }] : null;
      })
      .filter(Boolean),
  );
  const hasMasterLabRows = masterLabNames.length > 0;
  const inventoryDeviceCodes = (Array.isArray(devices) ? devices : [])
    .map((device) => normalizeText(device?.code))
    .filter((code) => !hasMasterLabRows || masterLabNames.includes(code) || TEST_LABS.includes(code));
  const baseDeviceCodes = Array.from(
    new Set(
      []
        .concat(TEST_LABS)
        .concat(inventoryDeviceCodes)
        .concat(masterLabNames)
        .concat(
          visibleSchedules.map((schedule) => {
            const scheduleCode = resolveScheduleLabCode(schedule);
            if (scheduleCode && hasMasterLabRows) {
              const masterLab = (Array.isArray(masterLabs) ? masterLabs : [])
                .find((lab) => resolveLabRef(lab).code === scheduleCode);
              const masterName = getMasterLabName(masterLab);
              if (masterName) {
                return masterName;
              }
            }
            return normalizeText(schedule?.device);
          }),
        ),
    ),
  )
    .filter(Boolean)
    .filter((device) => !isRetentionDevice(device));

  const selectedTaskLabs = buildSelectedTaskLabSet({
    experiments,
    schedules: visibleSchedules,
    selectedTaskCode,
    tasks,
    masterLabs,
  });
  const deviceCodes = selectedTaskLabs && selectedTaskLabs.size > 0
    ? baseDeviceCodes.filter((device) => selectedTaskLabs.has(device))
    : normalizeText(filterDevice)
      ? baseDeviceCodes.filter((device) => normalizeText(device) === normalizeText(filterDevice))
      : baseDeviceCodes;

  const rows = deviceCodes.map((device) => {
    const labRef = masterLabByName.get(device) || { name: device };
    const deviceSchedules = visibleSchedules.filter((schedule) => scheduleMatchesLab(schedule, labRef));
    // 每个设备按“天 x 半天”拆成离散槽位，再聚合成最终显示段。
    const slots = dayList.flatMap((day) =>
      SLOT_SEQUENCE.map((segment) => {
        const range = segment === "am" ? SLOT_RANGES.morning : SLOT_RANGES.afternoon;
        const segmentStart = parseDate(`${day.key}T${range.start}:00`);
        const displaySegmentEnd = parseDate(`${day.key}T${range.end}:00`);
        const segmentEnd = segment === "am"
          ? parseDate(`${day.key}T${SLOT_RANGES.afternoon.start}:00`)
          : parseDate(`${toLocalDateValue(addDays(day.date, 1))}T${SLOT_RANGES.morning.start}:00`);
        const matched = deviceSchedules.filter((schedule) => {
          const startAt = parseDate(schedule?.start_at);
          const endAt = parseDate(schedule?.end_at);
          return startAt && endAt && overlaps(startAt, endAt, segmentStart, segmentEnd);
        });

        const slotKey = `${device}-${day.key}-${segment}`;
        if (matched.length === 0) {
          const unavailableMeta = resolveUnavailableSlotMeta({
            device: deviceByCode.get(device),
            deviceCode: device,
            endAt: segmentEnd,
            now,
            startAt: segmentStart,
          });
          return {
            className: unavailableMeta?.className || "gantt-slot idle",
            date: day.key,
            displayMode: "idle",
            items: [],
            key: slotKey,
            label: unavailableMeta?.label || "空闲",
            overflowCount: 0,
            scheduleId: "",
            segment,
            state: unavailableMeta?.state || "idle",
            title: unavailableMeta?.title || "空闲",
          };
        }

        if (hasScheduleOverlap(matched)) {
          // 同一半天命中多条且真实时间重叠时，仍按冲突槽位处理。
          return {
            className: "gantt-slot conflict",
            date: day.key,
            displayMode: "conflict",
            items: [],
            key: slotKey,
            label: `${normalizeText(matched[0]?.task_code)} +${matched.length - 1}`,
            overflowCount: 0,
            scheduleId: normalizeText(matched[0]?.id),
            segment,
            state: "conflict",
            title: "冲突",
          };
        }

        const items = buildSlotTaskItems({ matchedSchedules: matched, now, experimentNameByCode });
        const maintenanceConflictMeta = resolveMaintenanceConflictSlotMeta({
          device: deviceByCode.get(device),
          deviceCode: device,
          matchedSchedules: matched,
          now,
          segmentEnd,
          segmentStart,
        });
        if (maintenanceConflictMeta) {
          return {
            className: maintenanceConflictMeta.className,
            allItems: items,
            date: day.key,
            displayMode: "conflict",
            items,
            key: slotKey,
            label: maintenanceConflictMeta.label,
            overflowCount: Math.max(0, items.length - 1),
            scheduleId: normalizeText(matched[0]?.id),
            segment,
            stackKey: slotKey,
            state: maintenanceConflictMeta.state,
            taskColor: items[0]?.color || resolveTaskColor(matched[0]?.task_code),
            title: [maintenanceConflictMeta.title, ...items.map((item) => item.title)].filter(Boolean).join("\n"),
          };
        }
        const scheduleMaintenanceMeta = resolveScheduleMaintenanceSlotMeta({
          device: deviceByCode.get(device),
          deviceCode: device,
          matchedSchedules: matched,
          now,
          segmentEnd: displaySegmentEnd,
          segmentStart,
        });
        if (scheduleMaintenanceMeta && items.length === 1) {
          return {
            className: "gantt-slot gantt-slot--mixed",
            allItems: items,
            date: day.key,
            displayMode: "schedule-maintenance",
            items,
            key: slotKey,
            label: normalizeText(matched[0]?.task_code),
            maintenance: scheduleMaintenanceMeta.maintenance,
            overflowCount: 0,
            scheduleId: normalizeText(matched[0]?.id),
            segment,
            stackKey: slotKey,
            state: "schedule-maintenance",
            task: scheduleMaintenanceMeta.task,
            taskColor: items[0]?.color || resolveTaskColor(matched[0]?.task_code),
            timelineOrder: scheduleMaintenanceMeta.timelineOrder,
            title: scheduleMaintenanceMeta.timelineOrder
              .map((itemType) => (itemType === "maintenance" ? scheduleMaintenanceMeta.maintenance.title : items[0]?.title))
              .filter(Boolean)
              .join("\n"),
          };
        }
        const slotTitle = items.map((item, index) => `${index >= 2 ? "隐藏: " : ""}${item.title}`).join("\n");
        if (items.length === 2) {
          return {
            className: "gantt-slot busy gantt-slot--split",
            allItems: items,
            date: day.key,
            displayMode: "split",
            items,
            key: slotKey,
            label: items[0]?.taskCode || "",
            overflowCount: 0,
            scheduleId: "",
            segment,
            stackKey: slotKey,
            state: "split",
            title: slotTitle,
          };
        }
        if (items.length > 1) {
          return {
            className: "gantt-slot busy gantt-slot--stacked",
            allItems: items,
            date: day.key,
            displayMode: "stacked",
            items: items.slice(0, 2),
            key: slotKey,
            label: items[0]?.taskCode || "",
            overflowCount: Math.max(0, items.length - 2),
            scheduleId: "",
            segment,
            stackKey: slotKey,
            state: "stacked",
            title: slotTitle,
          };
        }

        const schedule = matched[0];
        const startAt = parseDate(schedule?.start_at);
        const endAt = parseDate(schedule?.end_at);
        const lifecycleState = resolveScheduleLifecycleState({
          schedule,
          samples,
          experimentTrayMap,
          experimentNameByCode,
          trayExperimentCodeMap,
        });
        const stateMeta = getSlotState({ completed: lifecycleState.completed, endAt, now, startAt, started: lifecycleState.started });
        return {
          className: stateMeta.className,
          allItems: items,
          date: day.key,
          displayMode: "single",
          items,
          key: slotKey,
          label: normalizeText(schedule?.task_code),
          overflowCount: 0,
          scheduleId: normalizeText(schedule?.id),
          segment,
          stackKey: slotKey,
          state: stateMeta.state,
          taskColor: items[0]?.color || resolveTaskColor(schedule?.task_code),
          title: items[0]?.title || `${normalizeText(schedule?.task_code)} ${formatDateTime(schedule?.start_at)}-${formatDateTime(schedule?.end_at)}`.trim(),
        };
      }),
    );

    const segments = [];
    slots.forEach((slot) => {
      // 空闲类槽位可折叠；同一条排程跨多个半天槽位也可延展，但不同排程不合并。
      const signature = slot.state === "idle" || slot.state === "maintenance" || slot.state === "disabled"
        ? `${slot.state}:${slot.label}:${slot.title}`
        : slot.state === "conflict" || slot.state === "stacked" || slot.state === "split"
          ? `${slot.state}:${slot.key}`
          : `${slot.label}:${slot.className}`;
      const previous = segments[segments.length - 1];
      const canMergeSlot =
        slot.state === "idle"
        || slot.state === "maintenance"
        || slot.state === "disabled"
        || (
          slot.displayMode === "single"
          && previous?.displayMode === "single"
          && normalizeText(slot.scheduleId)
          && normalizeText(slot.scheduleId) === normalizeText(previous.scheduleId)
        );
      if (canMergeSlot && previous && previous.signature == signature) {
        previous.colspan += 1;
        previous.allItems = mergeGanttItems(previous.allItems, slot.allItems || slot.items);
        previous.items = mergeGanttItems(previous.items, slot.items);
        previous.scheduleIds = collectGanttScheduleIds(previous.allItems);
        previous.title = previous.allItems.map((item) => item.title).filter(Boolean).join("\n");
        return;
      }
      const allItems = slot.allItems || slot.items;
      const scheduleIds = collectGanttScheduleIds(allItems);
      segments.push({
        className: slot.className,
        allItems,
        colspan: 1,
        displayMode: slot.displayMode,
        items: slot.items,
        key: `${slot.key}-segment`,
        label: slot.label,
        maintenance: slot.maintenance,
        overflowCount: slot.overflowCount,
        scheduleId: slot.scheduleId,
        scheduleIds,
        signature,
        stackKey: slot.stackKey || slot.key,
        state: slot.state,
        taskColor: slot.taskColor || slot.items?.[0]?.color || "",
        task: slot.task,
        timelineOrder: slot.timelineOrder,
        title: slot.title,
      });
    });

    return {
      device,
      segments: segments.map((segment) => {
        const nextSegment = { ...segment };
        delete nextSegment.signature;
        return nextSegment;
      }),
      slots,
    };
  });

  return { days: dayList, rows };
}

// 构建留样面板中等待暂存的任务和样品行数据。
function buildRetentionInternalRows({ tasks, schedules, now = serverNowDate() }) {
  const taskByCode = new Map((Array.isArray(tasks) ? tasks : []).map((task) => [normalizeText(task?.code), task]));
  const nonRetentionCodes = new Set(
    (Array.isArray(schedules) ? schedules : [])
      .filter((schedule) => !isRetentionDevice(schedule))
      .map((schedule) => normalizeText(schedule?.task_code))
      .filter(Boolean),
  );

  const rowsByCode = new Map();

  // 留样面板只关注“仅在暂存间且尚未进入正式实验”的任务。
  (Array.isArray(schedules) ? schedules : []).forEach((schedule) => {
    const taskCode = normalizeText(schedule?.task_code);
    if (!taskCode || nonRetentionCodes.has(taskCode) || !isRetentionDevice(schedule)) {
      return;
    }
    const existing = rowsByCode.get(taskCode) || {
      code: taskCode,
      name: normalizeText(taskByCode.get(taskCode)?.name),
      testType: normalizeText(taskByCode.get(taskCode)?.test_type),
      waitLabel: "--",
      since: null,
      sinceText: "-",
    };
    const startAt = parseDate(schedule?.start_at);
    if (startAt && (!existing.since || startAt < existing.since)) {
      existing.since = startAt;
    }
    rowsByCode.set(taskCode, existing);
  });

  return Array.from(rowsByCode.values())
    .map((row) => {
      // 等待时长按最早进入暂存间的时间计算整小时差。
      const since = row.since;
      const elapsedHours = since ? Math.max(0, Math.floor((now.getTime() - since.getTime()) / (1000 * 60 * 60))) : 0;
      return {
        ...row,
        sinceText: since ? formatDateTime(since) : "-",
        waitLabel: since ? `${elapsedHours}h` : "--",
      };
    })
    .sort((left, right) => {
      const leftTime = left.since?.getTime() || Number.MAX_SAFE_INTEGER;
      const rightTime = right.since?.getTime() || Number.MAX_SAFE_INTEGER;
      return leftTime - rightTime;
    });
}

// 生成手动排程表单使用的下拉选项。
function buildManualTaskOptions({ tasks, experiments, experimentTrays, experimentRunSteps = [], samples, schedules }) {
  const { activeTasks } = buildActiveTaskContext(tasks, samples);
  const taskList = Array.isArray(tasks) && tasks.length > 0 ? activeTasks : [];
  const activeSchedules = filterSchedulesForActiveTasks({ schedules, tasks, samples });
  const pendingExperimentTaskCodes = new Set(
    taskList
      .map((task) => normalizeText(task?.code))
      .filter((taskCode) =>
        Boolean(
          taskCode &&
            buildExperimentOptions({
              experiments,
              experimentRunSteps,
              samples,
              schedules: activeSchedules,
              taskCode,
              tasks: taskList,
            }).length > 0,
        ),
      )
      .filter(Boolean),
  );

  // 正常排程页签优先显示仍有未排实验的任务。
  return taskList
    .filter((task) => {
      const taskCode = normalizeText(task?.code);
      if (!taskCode) {
        return false;
      }
      if (!taskHasSavedTrayPlan({ experimentTrays, samples, task })) {
        return false;
      }
      if (pendingExperimentTaskCodes.size > 0) {
        return pendingExperimentTaskCodes.has(taskCode);
      }
      return normalizeText(task?.status) === STATUS_WAITING;
    })
    .map((task) => ({
      code: normalizeText(task?.code),
      label: normalizeText(task?.code),
      testType: normalizeText(task?.test_type),
    }));
}

function buildLabOptions({ testType, selectedDevice = "", masterLabs = [] }) {
  let labs = normalizeText(testType) ? resolveLabCandidates(normalizeText(testType), masterLabs) : [];
  if (selectedDevice && !labs.includes(selectedDevice)) {
    labs = [...labs, selectedDevice];
  }
  return labs;
}

// 根据当前时钟计算留样时间状态标签。
function resolveRetentionTimeState(now = serverNowDate()) {
  const current = new Date(now.getTime());
  const timeValue = toLocalTimeValue(current);
  const morningStart = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.morning.start}:00`);
  const morningEnd = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.morning.end}:00`);
  const afternoonStart = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.afternoon.start}:00`);
  const afternoonEnd = parseDate(`${toLocalDateValue(current)}T${SLOT_RANGES.afternoon.end}:00`);
  let timeSlot = "custom";

  // 当前时刻落在上午/下午固定窗口内时，优先回填对应快捷时段。
  if (morningStart && morningEnd && current >= morningStart && current <= morningEnd) {
    timeSlot = "morning";
  } else if (afternoonStart && afternoonEnd && current >= afternoonStart && current <= afternoonEnd) {
    timeSlot = "afternoon";
  }

  return {
    custom_end: timeValue,
    custom_start: timeValue,
    schedule_date: toLocalDateValue(current),
    time_slot: timeSlot,
  };
}

// 构建排程看板上方展示的汇总卡片。
function buildSummaryCards({ schedules, tasks = [], samples = [], experiments = [], experimentTrays = [], now = serverNowDate() }) {
  const rows = buildScheduleRows({ schedules, tasks, samples, experiments, experimentTrays, now });
  const conflictRows = buildConflictRows({ schedules, tasks, samples, experiments, experimentTrays });
  return {
    changeCount: 0,
    conflictCount: conflictRows.length,
    nextAuto: formatDateTime(new Date(now.getTime() + 30 * 60 * 1000)),
    scheduleCount: rows.length,
  };
}

// 持久化辅助逻辑会在更新排程时同步任务和数据流状态。
function syncTaskStatuses(tasks, schedules, now = serverNowDate(), samples = [], experimentTrays = []) {
  return (Array.isArray(tasks) ? tasks : []).map((task) => ({
    ...task,
    // 任务状态完全以当前排程快照重新计算，避免手工同步多处状态。
    status: resolveTaskStatus(task, schedules, samples, now, experimentTrays),
  }));
}

function hasFormalExperimentSchedule(schedules, taskCode, experimentCode) {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode);
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    return false;
  }

  return (Array.isArray(schedules) ? schedules : []).some(
    (schedule) =>
      normalizeText(schedule?.task_code) === normalizedTaskCode &&
      normalizeText(schedule?.experiment_code) === normalizedExperimentCode &&
      !isRetentionDevice(schedule),
  );
}

function syncExperimentUnscheduledSince({
  experiments,
  experimentRunSteps = [],
  schedules,
  taskCode,
  experimentCode,
  tasks = [],
  samples = [],
}) {
  const normalizedTaskCode = normalizeText(taskCode);
  const normalizedExperimentCode = normalizeText(experimentCode);
  const nextExperiments = Array.isArray(experiments) ? experiments.map((experiment) => ({ ...experiment })) : [];
  if (!normalizedTaskCode || !normalizedExperimentCode) {
    return nextExperiments;
  }

  const hasFormalSchedule = hasFormalExperimentSchedule(schedules, normalizedTaskCode, normalizedExperimentCode);
  const task = (Array.isArray(tasks) ? tasks : []).find(
    (entry) => normalizeText(entry?.code || entry?.task_code) === normalizedTaskCode,
  );
  const taskSamples = (Array.isArray(samples) ? samples : []).filter(
    (sample) => normalizeText(sample?.task_code) === normalizedTaskCode,
  );
  const confirmedAt = resolveTransferConfirmedAt({ samples: taskSamples, task });
  return nextExperiments.map((experiment) => {
    if (
      normalizeText(experiment?.task_code) !== normalizedTaskCode ||
      normalizeText(experiment?.experiment_code) !== normalizedExperimentCode
    ) {
      return experiment;
    }

    const axisCodes = resolveExperimentAxisCodes(experiment);
    const completedAxisCodes = completedAxisCodesForExperiment({
      experimentCode: normalizedExperimentCode,
      experimentRunSteps,
      taskCode: normalizedTaskCode,
    });
    const completedRequiredAxisCodes = axisCodes.filter((axisCode) => completedAxisCodes.includes(axisCode));
    const hasPartialAxisProgress =
      experimentSupportsAxisScheduling(experiment) &&
      axisCodes.length > 0 &&
      completedRequiredAxisCodes.length > 0 &&
      completedRequiredAxisCodes.length < axisCodes.length;

    return {
      ...experiment,
      status: hasPartialAxisProgress ? STATUS_RUNNING : hasFormalSchedule ? experiment.status : STATUS_WAITING,
      unscheduled_since:
        hasFormalSchedule || hasPartialAxisProgress ? "" : confirmedAt ? formatLocalDateTime(confirmedAt) : "",
    };
  });
}

function buildExperimentOptions({ taskCode, experiments, experimentRunSteps = [], schedules, tasks, samples = [] }) {
  const { activeTasks, activeTaskCodes } = buildActiveTaskContext(tasks, samples);
  const taskList = Array.isArray(tasks) && tasks.length > 0 ? activeTasks : tasks;
  const normalizedTaskCode = normalizeText(taskCode);
  if (activeTaskCodes && normalizedTaskCode && !activeTaskCodes.has(normalizedTaskCode)) {
    return [];
  }
  const activeSchedules = filterSchedulesForActiveTasks({ schedules, tasks, samples });
  const seenLabels = new Set();
  return buildExperimentCandidates({ taskCode, experiments, tasks: taskList })
    .map((experiment) => {
      const experimentCode = normalizeText(experiment?.experiment_code);
      const experimentTerminal = isTerminalExperimentStatus(experiment?.status ?? experiment?.experiment_status);
      const axisCodes = resolveExperimentAxisCodes(experiment);
      const scheduledAxisCodes = scheduledAxisCodesForExperiment({ experimentCode, schedules: activeSchedules });
      const completedAxisCodes = completedAxisCodesForExperiment({
        experimentCode,
        experimentRunSteps,
        taskCode: normalizeText(experiment?.task_code),
      });
      const unavailableAxisCodes = new Set([...scheduledAxisCodes, ...completedAxisCodes]);
      const remainingAxisCodes = axisCodes.filter((axisCode) => !unavailableAxisCodes.has(axisCode));
      const completedRequiredAxisCodes = axisCodes.filter((axisCode) => completedAxisCodes.includes(axisCode));
      const matchingFormalSchedules = activeSchedules.filter(
        (schedule) =>
          !isRetentionDevice(schedule) &&
          normalizeText(schedule?.experiment_code) === experimentCode,
      );
      const hasFormalSchedule = matchingFormalSchedules.length > 0;
      const hasAxisFormalSchedule = matchingFormalSchedules.some(
        (schedule) => normalizeAxisCodes(schedule?.axis_codes ?? schedule?.axisCodes).length > 0,
      );
      const axisExperimentComplete =
        experimentSupportsAxisScheduling(experiment) &&
        axisCodes.length > 0 &&
        completedRequiredAxisCodes.length === axisCodes.length;
      const hasUnscheduledAxisAfterPartialCompletion =
        experimentSupportsAxisScheduling(experiment) &&
        axisCodes.length > 0 &&
        completedRequiredAxisCodes.length > 0 &&
        remainingAxisCodes.length > 0;
      return {
        experiment,
        axisCodes,
        scheduledAxisCodes,
        completedAxisCodes,
        remainingAxisCodes,
        hiddenByExperimentStatus: experimentTerminal && !hasUnscheduledAxisAfterPartialCompletion,
        hiddenByCompletedAxes: axisExperimentComplete,
        hiddenBySchedule:
          hasFormalSchedule &&
          (!experimentSupportsAxisScheduling(experiment) || !hasAxisFormalSchedule || remainingAxisCodes.length === 0),
      };
    })
    .filter((entry) => !entry.hiddenByExperimentStatus && !entry.hiddenBySchedule && !entry.hiddenByCompletedAxes)
    .map((entry) => {
      const experiment = entry.experiment;
      const experimentCode = normalizeText(experiment?.experiment_code);
      const typeLabel = resolveExperimentTypeLabel(experiment) || experimentCode;
      const option = {
        code: experimentCode,
        fullCode: experimentCode,
        label: typeLabel,
        requiredDevice: normalizeText(experiment?.required_device) || typeLabel,
        taskCode: normalizeText(experiment?.task_code),
      };
      if (
        entry.axisCodes.length > 0 ||
        entry.scheduledAxisCodes.length > 0 ||
        entry.completedAxisCodes.length > 0 ||
        entry.remainingAxisCodes.length > 0
      ) {
        option.axisCodes = entry.axisCodes;
        option.scheduledAxisCodes = entry.scheduledAxisCodes;
        option.completedAxisCodes = entry.completedAxisCodes;
        option.remainingAxisCodes = entry.remainingAxisCodes;
      }
      option.supportsAxisScheduling = experimentSupportsAxisScheduling(experiment);
      return option;
    })
    .filter((option) => {
      const label = normalizeText(option.label);
      if (!label || seenLabels.has(label)) {
        return false;
      }
      seenLabels.add(label);
      return true;
    });
}


export {
  analyzeTaskTrayConflict,
  buildConflictRows,
  buildExperimentOptions,
  buildGanttRows,
  buildLabOptions,
  buildManualTaskOptions,
  buildRetentionInternalRows,
  buildScheduleRows,
  buildSummaryCards,
  buildTaskScheduledOverlays,
  hasFormalExperimentSchedule,
  resolveRetentionTimeState,
  syncExperimentUnscheduledSince,
  syncTaskStatuses,
};
