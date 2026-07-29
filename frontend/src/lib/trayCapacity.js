export const SYSTEM_TRAY_TOTAL = 10;

export function getRemainingSystemTrayCount(occupiedTrayCount) {
  const occupied = Number.parseInt(String(occupiedTrayCount ?? 0), 10);
  return Math.max(0, SYSTEM_TRAY_TOTAL - (Number.isFinite(occupied) ? occupied : 0));
}
