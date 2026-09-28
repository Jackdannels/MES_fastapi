import { afterEach, expect, test, vi } from "vitest";
import { checkBackupPath, readBackupStatus, saveBackupPath, selectBackupDirectory } from "./testDataBackupApi";

afterEach(() => vi.unstubAllGlobals());

test("backup API uses independent endpoints and preserves UNC backslashes", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetch);
  const path = "\\\\server\\share\\试验数据";
  await readBackupStatus();
  await checkBackupPath(` ${path} `);
  await saveBackupPath(path);
  await selectBackupDirectory(path);
  expect(fetch.mock.calls.map(([url]) => url)).toEqual([
    "/api/test-data/backup-status", "/api/test-data/backup-check", "/api/test-data/backup-settings", "/api/test-data/backup-select-directory",
  ]);
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ backupPath: path });
  expect(fetch.mock.calls[2][1].method).toBe("PUT");
  expect(fetch.mock.calls.every(([, options]) => options.credentials === "include")).toBe(true);
});

test("save errors retain structured probe feedback", async () => {
  const probe = { ok: false, checks: [] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ detail: "拒绝访问", probe }) }));
  await expect(saveBackupPath("path")).rejects.toMatchObject({ message: "拒绝访问", probe });
});
