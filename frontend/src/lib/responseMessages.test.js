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

  test("排程冲突去掉英文包装，保留HTTP原值、撤回条件和托盘编号", () => {
    const error = new Error("Failed to write storage schedule patch: 409 Conflict，当前有托盘正在送往该排程试验间，删除后将自动撤回至发货点，请确认：SYLUN-2026-10-001-TP-001");
    error.code = "SCHEDULE_DELETE_WITHDRAW_CONFIRMATION";
    const raw = error.message;
    const text = localizeResponseMessage(`排程数据已加载，但过期排程自动清理未完成，${error.message}`);
    expect(text).toContain("请求失败（409）");
    expect(text).toContain("删除后将自动撤回至发货点");
    expect(text).toContain("SYLUN-2026-10-001-TP-001");
    expect(text).not.toMatch(/Failed|Conflict|错误编号/);
    expect(error.message).toBe(raw);
    expect(error.code).toBe("SCHEDULE_DELETE_WITHDRAW_CONFIRMATION");
  });

  test.each([
    ["读取失败：Failed to fetch", "读取失败：网络连接失败，请检查网络后重试"],
    ["安装失败：Permission denied，设备 LAB_01", "安装失败：访问权限不足，设备 LAB_01"],
    ["保存失败：[WinError 5] Access is denied: 'C:\\MES 数据\\report.pdf'", "保存失败：（系统错误 5） 访问被拒绝: 'C:\\MES 数据\\report.pdf'"],
    ["撤回失败：Unknown remote exception，托盘 TP-001，请刷新", "撤回失败：托盘 TP-001，请刷新"],
    ["目录为只读：read-only filesystem", "目录为只读"],
    ["账号 alice 不存在", "账号 alice 不存在"],
    ["轴向 X 无效", "轴向 X 无效"],
    ["消息发送失败：CONFIRMATION_TIMEOUT", "消息发送失败：CONFIRMATION_TIMEOUT"],
  ])("清理混合提示且保留识别值：%s", (value, expected) => {
    expect(localizeResponseMessage(value)).toBe(expected);
  });

  test("备份异常保留共享完整路径，技术英文在展开详情时同样清理", () => {
    const input = "[Errno 2] No such file or directory: '\\\\server\\MES共享\\report-001.pdf'";
    const result = localizeResponseMessage(input);
    expect(result).toContain("文件或目录不存在");
    expect(result).toContain("\\\\server\\MES共享\\report-001.pdf");
    expect(result).not.toMatch(/Errno|No such/);
  });

  test("纯英文异常使用中文兜底，重复处理不会改变中文或编号", () => {
    expect(localizeResponseMessage("Unexpected remote exception", "读取任务失败，请刷新")).toBe("读取任务失败，请刷新");
    const input = "操作失败（409），任务 SYLUN-2026-10-001，原错误码 SCHEDULE_LOCKED";
    expect(localizeResponseMessage(localizeResponseMessage(input))).toBe(input);
  });
});
