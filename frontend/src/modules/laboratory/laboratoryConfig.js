import { LABORATORY_OPTIONS } from "@/lib/moduleCatalog";
import { SALT_SPRAY_LAB } from "./laboratoryConstants";

const SALT_SPRAY_LAB_ID = "salt-spray-lab-01";
const SALT_SPRAY_LAB_CODE = "LAB_SALT";
const LABORATORY_SELECTED_LAB_STORAGE_KEY = "mes_laboratory_selected_lab_v1";

const normalizeText = (value) => String(value ?? "").trim();

const STATIC_LAB_CODES_BY_NAME = Object.freeze({
  "冲击一室": "LAB_IMPACT_1",
  "冲击二室": "LAB_IMPACT_2",
  "振动一室": "LAB_VIBRATION_1",
  "振动二室": "LAB_VIBRATION_2",
  "四综合实验室": "LAB_COMPREHENSIVE",
  "温度冲击一室": "LAB_TEMP_SHOCK_1",
  "温度冲击二室": "LAB_TEMP_SHOCK_2",
  "高低温湿热一室": "LAB_HOT_HUMID",
  "高低温湿热二室": "LAB_HOT_HUMID_2",
  "盐雾试验室": SALT_SPRAY_LAB_CODE,
  "霉菌试验室": "LAB_MOLD",
});
const STATIC_LAB_NAMES = Array.from(new Set([
  ...LABORATORY_OPTIONS.map((option) => option.label),
  ...Object.keys(STATIC_LAB_CODES_BY_NAME),
]));

export const createDefaultLaboratoryConfig = (labName = SALT_SPRAY_LAB) => ({
  labCode: STATIC_LAB_CODES_BY_NAME[labName] || (labName === SALT_SPRAY_LAB ? SALT_SPRAY_LAB_CODE : labName),
  labId: labName === SALT_SPRAY_LAB ? SALT_SPRAY_LAB_ID : (STATIC_LAB_CODES_BY_NAME[labName] || labName),
  labName,
  testTypeName: "",
});

export const normalizeSelectedLabName = (value) => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return normalizeText(rawValue);
};

export const readStoredLabName = () => {
  if (typeof window === "undefined") {
    return "";
  }
  return normalizeText(window.localStorage.getItem(LABORATORY_SELECTED_LAB_STORAGE_KEY));
};

export const writeStoredLabName = (labName) => {
  const normalizedLabName = normalizeText(labName);
  if (!normalizedLabName || typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(LABORATORY_SELECTED_LAB_STORAGE_KEY, normalizedLabName);
};

const resolveLabId = (lab, labName) =>
  normalizeText(lab?.mqttLabId || lab?.mqtt_lab_id)
  || (normalizeText(lab?.code || lab?.lab_code) === SALT_SPRAY_LAB_CODE ? SALT_SPRAY_LAB_ID : normalizeText(lab?.code || lab?.lab_code))
  || (labName === SALT_SPRAY_LAB ? SALT_SPRAY_LAB_ID : (STATIC_LAB_CODES_BY_NAME[labName] || labName));

const resolveLabCode = (lab, labName) =>
  normalizeText(lab?.code || lab?.lab_code)
  || STATIC_LAB_CODES_BY_NAME[labName]
  || (labName === SALT_SPRAY_LAB ? SALT_SPRAY_LAB_CODE : normalizeText(labName));

export const resolveLaboratoryConfig = (masterLabs = [], selectedLabName = "") => {
  const enabledLabs = (Array.isArray(masterLabs) ? masterLabs : []).filter((lab) => {
    if (Number(lab?.status ?? 1) === 0) {
      return false;
    }
    const type = normalizeText(lab?.type || lab?.lab_type);
    return !type || type === "实验室";
  });
  const requestedLabName = normalizeSelectedLabName(selectedLabName);
  const matchedRequestedLab = requestedLabName
    ? enabledLabs.find((lab) => normalizeText(lab?.name || lab?.lab_name) === requestedLabName)
    : null;
  const matchedLab =
    matchedRequestedLab
    || enabledLabs.find((lab) => normalizeText(lab?.code || lab?.lab_code) === SALT_SPRAY_LAB_CODE)
    || enabledLabs.find((lab) => normalizeText(lab?.name || lab?.lab_name) === SALT_SPRAY_LAB);
  if (!matchedLab) {
    const fallbackLabName = requestedLabName && STATIC_LAB_NAMES.includes(requestedLabName) ? requestedLabName : SALT_SPRAY_LAB;
    return createDefaultLaboratoryConfig(fallbackLabName);
  }
  const labName = normalizeText(matchedLab?.name || matchedLab?.lab_name);
  const resolvedLabName = labName || requestedLabName || SALT_SPRAY_LAB;
  return {
    labCode: resolveLabCode(matchedLab, resolvedLabName),
    labId: resolveLabId(matchedLab, resolvedLabName),
    labName: resolvedLabName,
    testTypeName: normalizeText(matchedLab?.testTypeName || matchedLab?.test_type_name || matchedLab?.testType || matchedLab?.test_type),
  };
};

export const countTrayRowSamples = (trayRows) =>
  (Array.isArray(trayRows) ? trayRows : []).reduce((total, row) => {
    const sampleCodes = Array.isArray(row?.sampleCodes) ? row.sampleCodes : [];
    const quantity = Number(row?.quantity);
    return total + (sampleCodes.length || (Number.isFinite(quantity) && quantity > 0 ? quantity : 1));
  }, 0);
