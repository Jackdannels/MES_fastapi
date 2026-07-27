import { describe, expect, test } from "vitest";

import { buildZipArchive } from "./zipArchive";

describe("task history zip archive", () => {
  test("builds a UTF-8 ZIP containing every requested tray file", async () => {
    const archive = await buildZipArchive([
      { content: "托盘一", name: "TP-001-托盘日志.csv" },
      { content: "托盘二", name: "TP-002-托盘日志.csv" },
    ], { modifiedAt: new Date("2026-07-27T10:00:00") });
    const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
    const decoded = new TextDecoder().decode(archive);

    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect([0, 8]).toContain(view.getUint16(8, true));
    expect(decoded).toContain("TP-001-托盘日志.csv");
    expect(decoded).toContain("TP-002-托盘日志.csv");
    expect(view.getUint32(archive.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(archive.length - 12, true)).toBe(2);
  });
});
