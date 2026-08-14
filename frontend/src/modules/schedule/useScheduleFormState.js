import { computed, nextTick, ref, watch } from "vue";

import { normalizeAxisCodes } from "@/lib/axisCodes";
import { LAB_CODE_BY_NAME } from "@/lib/labs";
import {
  AXIS_CODE_OPTIONS,
  buildExperimentOptions,
  buildLabOptions,
  buildManualTaskOptions,
  buildManualTimeSlotOptions,
  createManualScheduleForm,
  createScheduleEditForm,
  formatDateTime,
  isDeviceUnavailableForSchedule,
  isManualScheduleSelectionLegal,
  normalizeText,
  PLANNED_DURATION_MAX_DAYS,
  PLANNED_DURATION_MAX_HOURS,
  resolveAxisScheduleDeviceLock,
  resolveDeviceUnavailableReason,
  resolveLegalManualScheduleState,
  toLocalDateValue,
  toLocalTimeValue,
} from "./model";

function useScheduleFormState({
  activeSchedules,
  masterLabs,
  now,
  rawDevices,
  rawExperiments,
  rawExperimentRunSteps,
  rawExperimentTrays,
  rawSamples,
  rawTasks,
}) {
  const scheduleForm = ref(createManualScheduleForm());
  const editForm = ref(createScheduleEditForm());
  const scheduleWarning = ref("");
  const editWarning = ref("");
  const scheduleFormWatchSuspended = ref(false);

  const taskOptions = computed(() => buildManualTaskOptions({
    experiments: rawExperiments.value,
    experimentRunSteps: rawExperimentRunSteps.value,
    experimentTrays: rawExperimentTrays.value,
    samples: rawSamples.value,
    schedules: activeSchedules.value,
    tasks: rawTasks.value,
  }));

  const experimentOptions = computed(() => buildExperimentOptions({
    taskCode: scheduleForm.value.task_code,
    experiments: rawExperiments.value,
    experimentRunSteps: rawExperimentRunSteps.value,
    samples: rawSamples.value,
    schedules: activeSchedules.value,
    tasks: rawTasks.value,
  }));

  const selectedTaskOption = computed(
    () => taskOptions.value.find((option) => option.code === normalizeText(scheduleForm.value.task_code)) || null,
  );
  const selectedExperimentOption = computed(
    () => experimentOptions.value.find(
      (option) => option.code === normalizeText(scheduleForm.value.experiment_code),
    ) || null,
  );
  const axisOptionByCode = new Map(AXIS_CODE_OPTIONS.map((option) => [option.code, option]));
  const buildScheduleAxisOption = (axisCode) => {
    const normalizedAxisCode = normalizeText(axisCode).toLowerCase();
    return axisOptionByCode.get(normalizedAxisCode) || {
      code: normalizedAxisCode,
      label: normalizedAxisCode.toUpperCase(),
      testId: normalizedAxisCode.replace("+", "plus").replace("-", "minus"),
    };
  };
  const scheduleAxisRequirementOptions = computed(() => normalizeAxisCodes(
    selectedExperimentOption.value?.axisCodes,
  ).map(buildScheduleAxisOption));
  const scheduleCompletedAxisOptions = computed(() => normalizeAxisCodes(
    selectedExperimentOption.value?.completedAxisCodes,
  ).map(buildScheduleAxisOption));
  const scheduleAxisOptions = computed(() => normalizeAxisCodes(
    selectedExperimentOption.value?.remainingAxisCodes,
  ).map(buildScheduleAxisOption));
  const scheduleAxisCodes = computed(() => normalizeAxisCodes(scheduleForm.value.axis_codes));
  const scheduleAxisDisplayOptions = computed(() => scheduleAxisCodes.value.map(buildScheduleAxisOption));
  const showAxisSelector = computed(() => Boolean(
    selectedExperimentOption.value?.supportsAxisScheduling
    && (scheduleAxisRequirementOptions.value.length > 0 || scheduleAxisOptions.value.length > 0),
  ));
  const lockedAxisScheduleDevice = computed(() => resolveAxisScheduleDeviceLock({
    experimentCode: scheduleForm.value.experiment_code,
    experiments: rawExperiments.value,
    form: scheduleForm.value,
    schedules: activeSchedules.value,
  }));
  const selectedAxisLabel = computed(() => scheduleAxisCodes.value
    .map((code) => normalizeText(code).toUpperCase())
    .filter(Boolean)
    .join(" / "));

  const findDevice = (deviceCode) => rawDevices.value.find(
    (entry) => normalizeText(entry?.code) === normalizeText(deviceCode),
  );
  const resolveMasterLabName = (lab) => normalizeText(
    lab?.name || lab?.labName || lab?.lab_name || lab?.code || lab?.labCode || lab?.lab_code,
  );
  const resolveMasterLabCode = (lab) => normalizeText(lab?.code || lab?.labCode || lab?.lab_code);
  const resolveMasterLabId = (lab) => lab?.lab_id ?? lab?.labId ?? lab?.id ?? "";
  const findMasterLabByOptionValue = (value) => {
    const normalizedValue = normalizeText(value);
    if (!normalizedValue) {
      return null;
    }
    return masterLabs.value.find((lab) => {
      const labName = resolveMasterLabName(lab);
      const labCode = resolveMasterLabCode(lab);
      return labName === normalizedValue || labCode === normalizedValue;
    }) || null;
  };
  const buildLabIdentity = (value) => {
    const lab = findMasterLabByOptionValue(value);
    return {
      lab_code: resolveMasterLabCode(lab) || LAB_CODE_BY_NAME[normalizeText(value)] || "",
      lab_id: resolveMasterLabId(lab),
    };
  };
  const syncLabIdentityToForm = (form, optionItems = []) => {
    const selectedDevice = normalizeText(form?.device);
    if (!form || !selectedDevice) {
      if (form) {
        form.lab_code = "";
        form.lab_id = "";
      }
      return;
    }
    const option = (Array.isArray(optionItems) ? optionItems : [])
      .find((entry) => normalizeText(entry?.value) === selectedDevice);
    const identity = option || buildLabIdentity(selectedDevice);
    form.lab_code = normalizeText(identity?.lab_code ?? identity?.labCode);
    form.lab_id = identity?.lab_id ?? identity?.labId ?? "";
  };
  const buildUnavailableLabTitle = (deviceCode, device) => {
    const name = normalizeText(deviceCode);
    if (!name || !isDeviceUnavailableForSchedule(device, now.value)) {
      return "";
    }
    const reason = resolveDeviceUnavailableReason(device, now.value);
    if (reason === "disabled") {
      return `${name}已停用，暂不可排程`;
    }
    if (reason === "unavailable") {
      return `${name}不可用，暂不可排程`;
    }
    const startAt = normalizeText(device?.maintenance_start_at ?? device?.maintenanceStartAt);
    const endAt = normalizeText(device?.maintenance_end_at ?? device?.maintenanceEndAt);
    const range = startAt || endAt ? `（${formatDateTime(startAt)} - ${formatDateTime(endAt)}）` : "";
    return `${name}维修中，暂不可排程${range}`;
  };
  const buildLabOptionItems = ({ options, selectedDevice = "" }) => (
    Array.isArray(options) ? options : []
  ).map((option) => {
    const value = normalizeText(option);
    const device = findDevice(value);
    const disabled = normalizeText(selectedDevice) !== value && isDeviceUnavailableForSchedule(device, now.value);
    const title = disabled ? buildUnavailableLabTitle(value, device) : "";
    const identity = buildLabIdentity(value);
    return {
      disabled,
      label: value,
      lab_code: identity.lab_code,
      lab_id: identity.lab_id,
      title,
      value,
    };
  });
  const buildMaintenanceLabNotice = (options = []) => {
    const disabledOptions = (Array.isArray(options) ? options : [])
      .filter((option) => option?.disabled && normalizeText(option?.title));
    if (disabledOptions.length === 0) {
      return "";
    }
    if (disabledOptions.length === 1) {
      return normalizeText(disabledOptions[0]?.title);
    }
    const groupedBySuffix = [];
    disabledOptions.forEach((option) => {
      const label = normalizeText(option?.label);
      const title = normalizeText(option?.title);
      const suffix = label && title.startsWith(label) ? title.slice(label.length) : "";
      if (!suffix) {
        groupedBySuffix.push({ raw: title });
        return;
      }
      const group = groupedBySuffix.find((entry) => entry.suffix === suffix);
      if (group) {
        group.labels.push(label);
        return;
      }
      groupedBySuffix.push({ labels: [label], suffix });
    });
    return groupedBySuffix
      .map((group) => group.raw || `${group.labels.join("、")}${group.suffix}`)
      .join("；");
  };

  const manualLabOptionItems = computed(() => buildLabOptionItems({
    options: buildLabOptions({
      masterLabs: masterLabs.value,
      selectedDevice: normalizeText(scheduleForm.value.device),
      testType: selectedExperimentOption.value?.requiredDevice || selectedTaskOption.value?.testType || "",
    }).filter((option) => !lockedAxisScheduleDevice.value || normalizeText(option) === lockedAxisScheduleDevice.value),
    selectedDevice: normalizeText(scheduleForm.value.device),
  }));
  const manualLabOptions = computed(() => manualLabOptionItems.value
    .filter((option) => !option.disabled)
    .map((option) => option.value));
  const maintenanceLabNotice = computed(() => buildMaintenanceLabNotice(manualLabOptionItems.value));
  const manualTimeSlotOptions = computed(() => buildManualTimeSlotOptions({
    device: scheduleForm.value.device,
    labCode: scheduleForm.value.lab_code,
    labId: scheduleForm.value.lab_id,
    now: now.value,
    plannedDuration: scheduleForm.value.planned_hours,
    plannedDurationUnit: scheduleForm.value.planned_duration_unit,
    scheduleDate: scheduleForm.value.schedule_date,
    schedules: activeSchedules.value,
  }));

  const resolveCustomStartMinTime = (form) => {
    if (normalizeText(form?.time_slot) !== "custom") {
      return "";
    }
    const selectedDate = normalizeText(form?.schedule_date);
    if (!selectedDate || selectedDate !== toLocalDateValue(now.value)) {
      return "";
    }
    return toLocalTimeValue(now.value);
  };
  const scheduleCustomStartMinTime = computed(() => resolveCustomStartMinTime(scheduleForm.value));
  const editCustomStartMinTime = computed(() => resolveCustomStartMinTime(editForm.value));

  const resetScheduleForm = () => {
    scheduleForm.value = createManualScheduleForm(now.value);
    scheduleWarning.value = "";
  };
  const clearScheduleAxes = () => {
    scheduleForm.value.axis_codes = [];
    scheduleForm.value.axis_batch_no = "";
  };
  const toggleScheduleAxis = (axisCode) => {
    const normalizedAxisCode = normalizeText(axisCode).toLowerCase();
    if (!normalizedAxisCode) {
      return;
    }
    const selectableAxisCodes = new Set(scheduleAxisOptions.value.map((option) => option.code));
    if (!selectableAxisCodes.has(normalizedAxisCode)) {
      return;
    }
    const selected = new Set(scheduleAxisCodes.value);
    if (selected.has(normalizedAxisCode)) {
      selected.delete(normalizedAxisCode);
    } else {
      selected.add(normalizedAxisCode);
    }
    scheduleForm.value.axis_codes = scheduleAxisOptions.value
      .map((option) => option.code)
      .filter((code) => selected.has(code));
    scheduleWarning.value = "";
  };
  const isScheduleAxisSelected = (axisCode) => scheduleAxisCodes.value.includes(
    normalizeText(axisCode).toLowerCase(),
  );
  const replaceScheduleForm = async (nextForm) => {
    scheduleFormWatchSuspended.value = true;
    scheduleForm.value = nextForm;
    await nextTick();
    scheduleFormWatchSuspended.value = false;
  };
  const normalizeDurationValue = (value, fallback, unit = "hours") => {
    const parsed = Number.parseFloat(String(value ?? "").trim());
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return fallback;
    }
    const max = unit === "days" ? PLANNED_DURATION_MAX_DAYS : PLANNED_DURATION_MAX_HOURS;
    return Math.min(parsed, max);
  };
  const normalizeDayDurationValue = (value) => Math.min(
    PLANNED_DURATION_MAX_DAYS,
    Math.max(0.5, Math.round(value * 2) / 2),
  );
  const normalizeHourDurationValue = (value) => Math.min(
    PLANNED_DURATION_MAX_HOURS,
    Math.max(0.1, Math.round(value * 10) / 10),
  );
  const clampFormDurationValue = (form) => {
    const unit = normalizeText(form?.planned_duration_unit) || "hours";
    const max = unit === "days" ? PLANNED_DURATION_MAX_DAYS : PLANNED_DURATION_MAX_HOURS;
    const parsed = Number.parseFloat(String(form?.planned_hours ?? "").trim());
    if (Number.isFinite(parsed) && parsed > max) {
      form.planned_hours = max;
    }
  };
  const setDurationUnit = (formRef, nextUnit) => {
    const form = formRef.value;
    const currentUnit = normalizeText(form?.planned_duration_unit) || "hours";
    if (currentUnit === nextUnit) {
      return;
    }
    const currentValue = normalizeDurationValue(
      form?.planned_hours,
      currentUnit === "days" ? 0.5 : 1,
      currentUnit,
    );
    form.planned_duration_unit = nextUnit;
    if (nextUnit === "days") {
      form.planned_hours = normalizeDayDurationValue(Math.ceil(currentValue / 12) / 2);
      return;
    }
    form.planned_hours = normalizeHourDurationValue(currentValue * 24);
  };
  const setScheduleDurationUnit = (unit) => setDurationUnit(scheduleForm, unit);
  const setEditDurationUnit = (unit) => setDurationUnit(editForm, unit);
  const resetScheduleFormForTask = async ({ taskCode, schedules }) => {
    const baseForm = createManualScheduleForm(now.value);
    const nextExperimentCode = buildExperimentOptions({
      taskCode,
      experiments: rawExperiments.value,
      experimentRunSteps: rawExperimentRunSteps.value,
      samples: rawSamples.value,
      schedules,
      tasks: rawTasks.value,
    })[0]?.code || "";
    await replaceScheduleForm({
      ...baseForm,
      experiment_code: nextExperimentCode,
      task_code: taskCode,
    });
    clearScheduleAxes();
    scheduleWarning.value = "";
  };
  const syncManualScheduleLegality = () => {
    if (normalizeText(scheduleForm.value.time_slot) === "custom") {
      return;
    }
    if (isManualScheduleSelectionLegal(scheduleForm.value, now.value)) {
      return;
    }
    Object.assign(scheduleForm.value, resolveLegalManualScheduleState(now.value));
  };

  watch(
    () => scheduleForm.value.task_code,
    () => {
      if (scheduleFormWatchSuspended.value) return;
      scheduleForm.value.experiment_code = experimentOptions.value[0]?.code || "";
      scheduleForm.value.device = "";
      scheduleForm.value.lab_code = "";
      scheduleForm.value.lab_id = "";
      clearScheduleAxes();
      scheduleWarning.value = "";
    },
  );
  watch(
    () => scheduleForm.value.experiment_code,
    () => {
      if (scheduleFormWatchSuspended.value) return;
      scheduleForm.value.device = "";
      scheduleForm.value.lab_code = "";
      scheduleForm.value.lab_id = "";
      clearScheduleAxes();
      scheduleWarning.value = "";
    },
  );
  watch(
    () => scheduleAxisOptions.value.map((option) => option.code).join("\u0001"),
    () => {
      if (scheduleFormWatchSuspended.value) return;
      clearScheduleAxes();
    },
    { immediate: true },
  );
  const syncAutoSelectedScheduleDevice = () => {
    if (scheduleFormWatchSuspended.value) return;
    const availableLabs = manualLabOptionItems.value
      .filter((option) => !option.disabled)
      .filter((option) => normalizeText(option?.value));
    const currentDevice = normalizeText(scheduleForm.value.device);
    if (currentDevice && availableLabs.some((option) => normalizeText(option.value) === currentDevice)) {
      return;
    }
    if (availableLabs.length === 1) {
      scheduleForm.value.device = normalizeText(availableLabs[0].value);
      syncLabIdentityToForm(scheduleForm.value, availableLabs);
      return;
    }
    if (currentDevice) {
      scheduleForm.value.device = "";
      scheduleForm.value.lab_code = "";
      scheduleForm.value.lab_id = "";
    }
  };
  watch(
    () => [scheduleForm.value.experiment_code, manualLabOptions.value.join("\u0001")],
    syncAutoSelectedScheduleDevice,
  );
  watch(
    () => scheduleForm.value.device,
    () => {
      syncLabIdentityToForm(scheduleForm.value, manualLabOptionItems.value);
      scheduleWarning.value = "";
    },
  );
  watch(
    () => scheduleForm.value.time_slot,
    (nextSlot) => {
      if (nextSlot !== "custom") {
        scheduleForm.value.custom_start = "";
        scheduleForm.value.custom_end = "";
      }
    },
  );
  watch(
    () => scheduleForm.value.planned_duration_unit,
    () => clampFormDurationValue(scheduleForm.value),
  );
  watch(
    () => scheduleForm.value.planned_hours,
    () => clampFormDurationValue(scheduleForm.value),
  );
  watch(
    () => editForm.value.time_slot,
    (nextSlot) => {
      if (nextSlot !== "custom") {
        editForm.value.custom_start = "";
        editForm.value.custom_end = "";
      }
    },
  );
  watch(
    () => editForm.value.planned_duration_unit,
    () => clampFormDurationValue(editForm.value),
  );
  watch(
    () => editForm.value.planned_hours,
    () => clampFormDurationValue(editForm.value),
  );

  return {
    buildLabOptionItems,
    editCustomStartMinTime,
    editForm,
    editWarning,
    experimentOptions,
    maintenanceLabNotice,
    manualLabOptionItems,
    manualLabOptions,
    manualTimeSlotOptions,
    resetScheduleForm,
    resetScheduleFormForTask,
    replaceScheduleForm,
    scheduleAxisCodes,
    scheduleAxisDisplayOptions,
    scheduleAxisOptions,
    scheduleAxisRequirementOptions,
    scheduleCompletedAxisOptions,
    scheduleCustomStartMinTime,
    scheduleForm,
    scheduleWarning,
    selectedAxisLabel,
    selectedExperimentOption,
    selectedTaskOption,
    setEditDurationUnit,
    setScheduleDurationUnit,
    showAxisSelector,
    syncLabIdentityToForm,
    syncManualScheduleLegality,
    taskOptions,
    toggleScheduleAxis,
    isScheduleAxisSelected,
  };
}

export { useScheduleFormState };
