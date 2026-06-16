import { HOST_INTERFACE_MODES } from "./hostInterfaceMode.js";

const HOSTLESS_LAB_CODE = "LAB_HOT_HUMID_2";
const HOSTLESS_DELAY_MS = 3000;

const getLabHostInterfaceCapabilities = ({ hostInterfaceMode, labCode } = {}) => {
  const hostless =
    String(hostInterfaceMode || "").trim() === HOST_INTERFACE_MODES.mqtt
    && String(labCode || "").trim() === HOSTLESS_LAB_CODE;
  return {
    fixtureReadyDelayMs: hostless ? HOSTLESS_DELAY_MS : 0,
    hostless,
    startDelayMs: hostless ? HOSTLESS_DELAY_MS : 0,
  };
};

export { getLabHostInterfaceCapabilities };
