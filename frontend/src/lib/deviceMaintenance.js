import { serverNowDate } from "@/lib/serverClock";

const normalizeText = (value) => String(value ?? "").trim();

const parseDate = (value) => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed) : null;
};

const maintenanceStatusLabel = (device) => {
  const type = normalizeText(device?.maintenance_type ?? device?.maintenanceType);
  const status = normalizeText(device?.status);
  return type.includes("保养") || status.includes("保养") ? "保养" : "维修";
};

const resolveActiveDeviceMaintenance = (device, now = serverNowDate()) => {
  if (!device) {
    return null;
  }
  const current = parseDate(now) || serverNowDate();
  const startAt = parseDate(device?.maintenance_start_at ?? device?.maintenanceStartAt);
  const endAt = parseDate(device?.maintenance_end_at ?? device?.maintenanceEndAt);
  const storedStatus = normalizeText(device?.status);

  if (startAt) {
    if (startAt > current || (endAt && endAt < current)) {
      return null;
    }
    return {
      active: true,
      endAt,
      startAt,
      status: maintenanceStatusLabel(device),
    };
  }

  if (storedStatus.includes("维修") || storedStatus.includes("保养")) {
    return {
      active: true,
      endAt,
      startAt,
      status: maintenanceStatusLabel(device),
    };
  }
  return null;
};

export { resolveActiveDeviceMaintenance };
