const TRAY_QR_PREFIX = "MES-TRAY:";

function normalizeTrayCode(value) {
  return String(value || "").trim();
}

function buildTrayQrPayload(trayCode) {
  const normalized = normalizeTrayCode(trayCode);
  return normalized ? `${TRAY_QR_PREFIX}${normalized}` : "";
}

function normalizeTrayScanCode(value) {
  const normalized = normalizeTrayCode(value);
  if (normalized.toUpperCase().startsWith(TRAY_QR_PREFIX)) {
    return normalized.slice(TRAY_QR_PREFIX.length).trim();
  }
  return normalized;
}

export { TRAY_QR_PREFIX, buildTrayQrPayload, normalizeTrayScanCode };
