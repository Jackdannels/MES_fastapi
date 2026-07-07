import { afterEach, describe, expect, test, vi } from "vitest";

import {
  createAttendanceUser,
  deleteAttendanceUser,
  listLaboratoryAttendanceSessions,
  listAttendanceWorkTimes,
  loginLaboratoryAttendance,
  logoutLaboratoryAttendance,
  markLaboratoryAttendanceWorkStarted,
  readLaboratoryAttendanceSession,
  resetAttendanceUserPassword,
} from "./attendanceApi";

describe("attendanceApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("reads the current laboratory attendance session", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ active: false, labName: "冲击一室" }),
    }));

    await readLaboratoryAttendanceSession("冲击一室");

    expect(fetch).toHaveBeenCalledWith("/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/session", {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
  });

  test("lists active laboratory attendance sessions", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [{ active: true, employeeName: "张三", labName: "四综合实验室" }],
    }));

    const sessions = await listLaboratoryAttendanceSessions();

    expect(sessions).toEqual([{ active: true, employeeName: "张三", labName: "四综合实验室" }]);
    expect(fetch).toHaveBeenCalledWith("/api/attendance/lab-sessions", {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
  });

  test("posts laboratory attendance login credentials", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ active: true, username: "zhangsan" }),
    }));

    await loginLaboratoryAttendance({ labName: "冲击一室", username: "zhangsan", password: "123" });

    expect(fetch).toHaveBeenCalledWith("/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ username: "zhangsan", password: "123" }),
    });
  });

  test("posts laboratory attendance logout reason", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ active: false, labName: "冲击一室" }),
    }));

    await logoutLaboratoryAttendance({ labName: "冲击一室", reason: "completion-timeout" });

    expect(fetch).toHaveBeenCalledWith("/api/attendance/labs/%E5%86%B2%E5%87%BB%E4%B8%80%E5%AE%A4/logout", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({ reason: "completion-timeout" }),
    });
  });

  test("lists work times and creates employee accounts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    }));

    await listAttendanceWorkTimes("2026-07-02");
    await createAttendanceUser({
      username: "worker",
      password: "pw",
      employeeName: "员工",
      roleName: "试验员",
      active: true,
    });

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/attendance/work-times?date=2026-07-02", {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/attendance/users", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        username: "worker",
        password: "pw",
        employeeName: "员工",
        roleName: "试验员",
        active: true,
      }),
    });
  });

  test("starts laboratory attendance work timer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ active: true, workStartedAt: "2026-07-02T08:00:00Z" }),
    }));

    await markLaboratoryAttendanceWorkStarted("盐雾试验室");

    expect(fetch).toHaveBeenCalledWith("/api/attendance/labs/%E7%9B%90%E9%9B%BE%E8%AF%95%E9%AA%8C%E5%AE%A4/work/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({}),
    });
  });

  test("uses administrator credentials for password reset and employee deletion", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ok: true }),
    }));

    await resetAttendanceUserPassword(7, {
      adminUsername: "admin",
      adminPassword: "123",
      newPassword: "pw-new",
    });
    await deleteAttendanceUser(7, {
      adminUsername: "admin",
      adminPassword: "123",
    });

    expect(fetch).toHaveBeenNthCalledWith(1, "/api/attendance/users/7/password/reset", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ adminUsername: "admin", adminPassword: "123", newPassword: "pw-new" }),
    }));
    expect(fetch).toHaveBeenNthCalledWith(2, "/api/attendance/users/7", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ adminUsername: "admin", adminPassword: "123" }),
    }));
  });
});
