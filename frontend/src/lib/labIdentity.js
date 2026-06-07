const normalizeLabText = (value) => String(value ?? "").trim();

const normalizeLabId = (value) => {
  const normalized = normalizeLabText(value);
  return normalized;
};
const normalizeExplicitLabCode = (value) => {
  const normalized = normalizeLabText(value);
  return normalized.startsWith("LAB_") || normalized.startsWith("AREA_") ? normalized : "";
};

const resolveLabRef = (lab) => {
  if (typeof lab === "string") {
    const value = normalizeLabText(lab);
    return { aliases: [value].filter(Boolean), code: normalizeExplicitLabCode(value), id: "", name: value };
  }
  const explicitCode = normalizeExplicitLabCode(lab?.labCode || lab?.lab_code) || normalizeExplicitLabCode(lab?.code);
  const legacyCodeName = explicitCode ? "" : normalizeLabText(lab?.code);
  const name = normalizeLabText(lab?.name || lab?.labName || lab?.lab_name || lab?.label || lab?.device || lab?.device_name || lab?.deviceName)
    || legacyCodeName;
  return {
    aliases: Array.from(new Set([name, legacyCodeName].map(normalizeLabText).filter(Boolean))),
    code: explicitCode,
    id: normalizeLabId(lab?.lab_id ?? lab?.labId ?? ""),
    name,
  };
};

const resolveScheduleLabCode = (schedule) =>
  normalizeLabText(schedule?.lab_code || schedule?.labCode || schedule?.lab);

const resolveScheduleLabId = (schedule) =>
  normalizeLabId(schedule?.lab_id ?? schedule?.labId ?? "");

const resolveScheduleLabName = (schedule) =>
  normalizeLabText(schedule?.device || schedule?.device_name || schedule?.deviceName || schedule?.lab_name || schedule?.labName);

const STORAGE_LAB_CODES = new Set(["AREA_STAGING_PRE", "AREA_STAGING_POST", "AREA_APPEARANCE"]);
const isStorageLabCode = (code) => STORAGE_LAB_CODES.has(normalizeLabText(code));
const scheduleTargetsStorageArea = (schedule) => {
  const scheduleCode = resolveScheduleLabCode(schedule);
  if (scheduleCode) {
    return isStorageLabCode(scheduleCode);
  }
  const scheduleName = resolveScheduleLabName(schedule);
  return scheduleName.includes("暂存间") || scheduleName.includes("外观检测间");
};

const labIdentityMatches = (source, target) => {
  const sourceRef = {
    code: normalizeExplicitLabCode(source?.labCode || source?.lab_code || source?.lab || source?.targetLabCode || source?.target_lab_code || source?.currentLabCode || source?.current_lab_code || source?.locationCode || source?.location_code),
    id: normalizeLabId(source?.lab_id ?? source?.labId ?? source?.targetLabId ?? source?.target_lab_id ?? source?.currentLabId ?? source?.current_lab_id ?? ""),
    name: normalizeLabText(source?.name || source?.labName || source?.lab_name || source?.label || source?.device || source?.device_name || source?.deviceName || source?.targetLab || source?.target_lab || source?.location),
  };
  const targetRef = resolveLabRef(target);
  if (sourceRef.id && targetRef.id) {
    return sourceRef.id === targetRef.id;
  }
  if (sourceRef.code && targetRef.code) {
    return sourceRef.code === targetRef.code;
  }
  const targetAliases = targetRef.aliases?.length ? targetRef.aliases : [targetRef.name].filter(Boolean);
  return Boolean(
    (sourceRef.name && targetAliases.includes(sourceRef.name))
      || (targetRef.code && sourceRef.name === targetRef.code)
      || (sourceRef.code && targetAliases.includes(sourceRef.code)),
  );
};

const scheduleMatchesLab = (schedule, lab) =>
  labIdentityMatches({
    device: resolveScheduleLabName(schedule),
    lab_code: resolveScheduleLabCode(schedule),
    lab_id: resolveScheduleLabId(schedule),
  }, lab);

export {
  labIdentityMatches,
  isStorageLabCode,
  resolveLabRef,
  resolveScheduleLabCode,
  resolveScheduleLabId,
  resolveScheduleLabName,
  scheduleMatchesLab,
  scheduleTargetsStorageArea,
};
