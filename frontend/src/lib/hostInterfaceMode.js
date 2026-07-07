const HOST_INTERFACE_MODE_STORAGE_KEY = "mes_lab_host_interface_mode_v1";
const HOST_INTERFACE_MODE_CHANGED_EVENT = "mes:host-interface-mode-changed";
const HOST_INTERFACE_MODES = Object.freeze({
  mqtt: "mqtt",
});

const normalizeHostInterfaceMode = () => HOST_INTERFACE_MODES.mqtt;

const readHostInterfaceMode = () => {
  return HOST_INTERFACE_MODES.mqtt;
};

const writeHostInterfaceMode = (value) => {
  const mode = normalizeHostInterfaceMode(value);
  if (typeof window !== "undefined" && window.localStorage && typeof window.localStorage.setItem === "function") {
    window.localStorage.setItem(HOST_INTERFACE_MODE_STORAGE_KEY, mode);
    window.dispatchEvent(new CustomEvent(HOST_INTERFACE_MODE_CHANGED_EVENT, { detail: { mode } }));
  }
  return mode;
};

export {
  HOST_INTERFACE_MODE_CHANGED_EVENT,
  HOST_INTERFACE_MODES,
  HOST_INTERFACE_MODE_STORAGE_KEY,
  normalizeHostInterfaceMode,
  readHostInterfaceMode,
  writeHostInterfaceMode,
};
