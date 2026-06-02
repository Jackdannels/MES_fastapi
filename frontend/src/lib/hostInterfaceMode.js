const HOST_INTERFACE_MODE_STORAGE_KEY = "mes_lab_host_interface_mode_v1";
const HOST_INTERFACE_MODES = Object.freeze({
  mock: "mock",
  mqtt: "mqtt",
});

const normalizeHostInterfaceMode = (value) =>
  value === HOST_INTERFACE_MODES.mqtt ? HOST_INTERFACE_MODES.mqtt : HOST_INTERFACE_MODES.mock;

const readHostInterfaceMode = () => {
  if (typeof window === "undefined" || !window.localStorage || typeof window.localStorage.getItem !== "function") {
    return HOST_INTERFACE_MODES.mock;
  }
  return normalizeHostInterfaceMode(window.localStorage.getItem(HOST_INTERFACE_MODE_STORAGE_KEY));
};

const writeHostInterfaceMode = (value) => {
  const mode = normalizeHostInterfaceMode(value);
  if (typeof window !== "undefined" && window.localStorage && typeof window.localStorage.setItem === "function") {
    window.localStorage.setItem(HOST_INTERFACE_MODE_STORAGE_KEY, mode);
  }
  return mode;
};

export {
  HOST_INTERFACE_MODES,
  HOST_INTERFACE_MODE_STORAGE_KEY,
  normalizeHostInterfaceMode,
  readHostInterfaceMode,
  writeHostInterfaceMode,
};
