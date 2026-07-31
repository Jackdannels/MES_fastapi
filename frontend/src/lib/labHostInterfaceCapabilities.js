const HOSTLESS_LAB_CODE = "LAB_HOT_HUMID_2";
const HOSTLESS_LAB_NAME = "高低温湿热二室";
const HOSTLESS_DELAY_MS = 3000;
const HOST_INTERFACE_MQTT = "mqtt";
const HOST_INTERFACE_HOSTLESS = "hostless";

const normalizeText = (value) => String(value ?? "").trim();

const getLabHostInterfaceCapabilities = ({ labCode, labName } = {}) => {
  const usesHostlessFixtureReady =
    normalizeText(labCode) === HOSTLESS_LAB_CODE
    || normalizeText(labName) === HOSTLESS_LAB_NAME;
  return {
    experimentEndInterface: HOST_INTERFACE_MQTT,
    experimentStartInterface: HOST_INTERFACE_MQTT,
    fixtureReadyDelayMs: usesHostlessFixtureReady ? HOSTLESS_DELAY_MS : 0,
    fixtureReadyInterface: usesHostlessFixtureReady ? HOST_INTERFACE_HOSTLESS : HOST_INTERFACE_MQTT,
  };
};

export { getLabHostInterfaceCapabilities };
