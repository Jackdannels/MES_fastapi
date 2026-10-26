import { describe, expect, test } from "vitest";
import { describeBackupError } from "./backupErrorPresentation";

describe("backup error presentation", () => {
  test.each([
    ["[Errno 2] No such file or directory: '\\\\server\\share\\report.pdf'", "备份文件或目录不存在"],
    ["[WinError 5] Access is denied", "备份访问权限不足"],
    ["Permission denied", "备份访问权限不足"],
    ["连接超时", "备份连接超时"],
    ["[WinError 53] The network path was not found", "备份路径无法连接"],
  ])("summarizes a known failure without exposing the full path as the heading: %s", (raw, title) => {
    const result = describeBackupError(raw);
    expect(result.title).toBe(title);
    expect(result.hint.length).toBeGreaterThan(0);
  });

  test("does not guess a specific cause for an unknown error", () => {
    expect(describeBackupError("Unexpected archive response").title).toBe("备份未完成");
  });
});
