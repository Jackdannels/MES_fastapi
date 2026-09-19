import { describe, expect, test } from "vitest";
import { localizeResponseMessage } from "./responseMessages";

describe("中文响应提示", () => {
  test.each([
    ["Invalid administrator credentials", "管理员账号或密码错误"],
    ["New password is required", "请输入新密码"],
    ["读取日志失败: Invalid administrator credentials", "读取日志失败: 管理员账号或密码错误"],
    ["Failed to fetch", "网络连接失败，请检查网络后重试"],
    ["Tray not found: UNKNOWN-TRAY", "未找到托盘: UNKNOWN-TRAY"],
    ["body.trayLimit: Input should be less than or equal to 16", "托盘样品上限： 输入值不能大于 16"],
    ["未知设备 LAB_01，请刷新", "未知设备 LAB_01，请刷新"],
    ["Unexpected internal exception", "操作未完成，请稍后重试"],
  ])("%s", (input, expected) => expect(localizeResponseMessage(input)).toBe(expected));

  test("结构化校验错误显示字段中文，不显示对象字符串", () => {
    expect(localizeResponseMessage([
      { loc: ["body", "adminPassword"], type: "missing", msg: "Field required" },
      { loc: ["body", "username"], type: "string_type" },
    ])).toBe("请填写管理员密码；员工账号格式不正确，请检查后重试");
  });
});
