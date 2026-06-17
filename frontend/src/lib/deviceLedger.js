import { LAB_TEST_MAP } from "./labs.js";

const normalizeDeviceText = (value) => String(value ?? "").trim();

const HOT_HUMID_FIRST_ROOM = "高低温湿热一室";
const HOT_HUMID_SECOND_ROOM = "高低温湿热二室";

const REQUIRED_LAB_DEVICE_DEFAULTS = Object.freeze([
  Object.freeze({
    acquisition_enabled: "启用",
    code: HOT_HUMID_SECOND_ROOM,
    id: HOT_HUMID_SECOND_ROOM,
    location: HOT_HUMID_SECOND_ROOM,
    model: "",
    name: "高低温湿热系统-2",
    next_cal: "2024-06-30",
    owner: "",
    status: "可用",
    type: LAB_TEST_MAP[HOT_HUMID_SECOND_ROOM],
  }),
]);

const deviceHasLabIdentity = (device, labName) =>
  [device?.code, device?.name, device?.location].some((value) => normalizeDeviceText(value) === labName);

function withRequiredLabDevices(devices) {
  const deviceList = Array.isArray(devices) ? devices.map((device) => ({ ...device })) : [];
  if (!deviceList.length) {
    return [];
  }

  const hasFirstHotHumidRoom = deviceList.some((device) => deviceHasLabIdentity(device, HOT_HUMID_FIRST_ROOM));
  if (!hasFirstHotHumidRoom) {
    return deviceList;
  }

  REQUIRED_LAB_DEVICE_DEFAULTS.forEach((defaultDevice) => {
    const exists = deviceList.some((device) => deviceHasLabIdentity(device, defaultDevice.code));
    if (exists) {
      return;
    }
    const firstRoomIndex = deviceList.findIndex((device) => deviceHasLabIdentity(device, HOT_HUMID_FIRST_ROOM));
    const insertIndex = firstRoomIndex >= 0 ? firstRoomIndex + 1 : deviceList.length;
    deviceList.splice(insertIndex, 0, { ...defaultDevice });
  });

  return deviceList;
}

export { withRequiredLabDevices };
