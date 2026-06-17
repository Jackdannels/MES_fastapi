import { HOST_INTERFACE_MODES } from "./hostInterfaceMode.js";

const HOSTLESS_LAB_CODE = "LAB_HOT_HUMID_2";
const HOSTLESS_LAB_NAME = "高低温湿热二室";
const HOSTLESS_DELAY_MS = 3000;

const normalizeText = (value) => String(value ?? "").trim();

const getLabHostInterfaceCapabilities = ({ hostInterfaceMode, labCode, labName } = {}) => {
  const hostless =
    normalizeText(hostInterfaceMode) === HOST_INTERFACE_MODES.mqtt
    && (
      normalizeText(labCode) === HOSTLESS_LAB_CODE
      || normalizeText(labName) === HOSTLESS_LAB_NAME
    );
  return {
    fixtureReadyDelayMs: hostless ? HOSTLESS_DELAY_MS : 0,
    hostless,
    startDelayMs: hostless ? HOSTLESS_DELAY_MS : 0,
  };
};

export { getLabHostInterfaceCapabilities };
