import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import SystemPage from "./page.vue";

describe("SystemPage runtime", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const stubAttendanceFetch = () => {
    const employees = [
      {
        active: true,
        allowedLabs: ["*"],
        currentLabName: "冲击一室",
        employeeName: "张三",
        hasQrToken: false,
        id: 1,
        lastLoginAt: "2026-07-02T08:15:00Z",
        online: true,
        qrTokenCreatedAt: null,
        roleName: "试验员",
        todaySeconds: 9300,
        username: "zhangsan",
      },
    ];
    vi.stubGlobal("fetch", vi.fn(async (input) => {
      const url = String(input);
      if (url.includes("/api/attendance/work-times")) {
        return {
          ok: true,
          json: async () => employees,
        };
      }
      if (url.includes("/api/attendance/users")) {
        if (String(input).endsWith("/api/attendance/users")) {
          return {
            ok: true,
            json: async () => [],
          };
        }
        return {
          ok: true,
          json: async () => [],
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    }));
    return employees;
  };

  const flushPromises = async (cycles = 4) => {
    for (let index = 0; index < cycles; index += 1) {
      await Promise.resolve();
    }
    await nextTick();
  };

  test("renders personnel maintenance and work-time overview without base settings", async () => {
    stubAttendanceFetch();
    const wrapper = mount(SystemPage);
    await flushPromises();
    const pageText = wrapper.text();

    expect(pageText).toContain("人员信息维护");
    expect(pageText).toContain("人员工作时间一览表");
    expect(wrapper.find(".system-settings-card").exists()).toBe(false);
    expect(pageText).not.toContain("基础配置");
    expect(pageText).not.toContain("班次配置");
    expect(pageText).not.toContain("数据保留周期");
    expect(pageText).not.toContain("通知方式");
    expect(pageText).not.toContain("角色权限矩阵");
    expect(pageText).toContain("张三");
    expect(pageText).toContain("zhangsan");
    expect(pageText).toContain("2小时35分0秒");
    expect(pageText).toContain("冲击一室");
    expect(pageText).not.toContain("可登录试验间");
    expect(wrapper.get('[data-testid="open-employee-operation-logs"]').text()).toBe("员工工作日志");
  });

  test("paginates personnel and work-time tables independently with eight fixed row slots", async () => {
    const employees = stubAttendanceFetch();
    for (let index = 2; index <= 17; index += 1) {
      employees.push({
        ...employees[0],
        currentLabName: index % 2 === 0 ? "" : "振动一室",
        employeeName: `员工${index}`,
        id: index,
        online: index % 2 !== 0,
        todaySeconds: index * 60,
        username: `employee${index}`,
      });
    }

    const wrapper = mount(SystemPage);
    await flushPromises();

    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(8);
    expect(wrapper.findAll("#employee-worktime-table tbody tr")).toHaveLength(8);
    expect(wrapper.get('[data-testid="employee-pagination-range"]').text()).toContain("1–8");
    expect(wrapper.get('[data-testid="worktime-pagination-range"]').text()).toContain("1–8");
    expect(wrapper.findAll(".system-paginated-table-stage")).toHaveLength(2);

    await wrapper.get('[data-testid="employee-pagination"] [data-page="next"]').trigger("click");

    expect(wrapper.get("#employee-table tbody tr:first-child td").text()).toBe("9");
    expect(wrapper.get('[data-testid="employee-pagination-range"]').text()).toContain("9–16");
    expect(wrapper.get("#employee-worktime-table tbody tr:first-child td").text()).toBe("1");
    expect(wrapper.get('[data-testid="worktime-pagination-range"]').text()).toContain("1–8");

    await wrapper.get('[data-testid="employee-pagination"] [data-page="next"]').trigger("click");

    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(1);
    expect(wrapper.get("#employee-table tbody tr:first-child td").text()).toBe("17");
    expect(wrapper.get('[data-testid="employee-pagination-range"]').text()).toContain("17–17");

    await wrapper.get('[data-testid="worktime-pagination"] [data-page="next"]').trigger("click");

    expect(wrapper.get("#employee-worktime-table tbody tr:first-child td").text()).toBe("9");
    expect(wrapper.get('[data-testid="worktime-pagination-range"]').text()).toContain("9–16");
    expect(wrapper.get("#employee-table tbody tr:first-child td").text()).toBe("17");
  });

  test("provides default administrator credentials and independently confirmed work-log filters", async () => {
    stubAttendanceFetch();
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="open-employee-operation-logs"]').trigger("click");

    expect(wrapper.get('[data-testid="operation-log-admin-username"]').element.value).toBe("admin");
    expect(wrapper.get('[data-testid="operation-log-admin-password"]').element.value).toBe("123");
    expect(wrapper.get('[data-testid="operation-log-date"]').element.value).toMatch(/^\d{4} \/ \d{2} \/ \d{2}$/);

    await wrapper.get('[data-testid="operation-log-date"]').trigger("click");
    expect(wrapper.find(".picker-only-calendar").exists()).toBe(true);

    await wrapper.get('[data-testid="operation-log-employee"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-employee-step"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="operation-log-lab-step"]').exists()).toBe(false);
    const employeeOption = wrapper.get('[data-testid="operation-log-employee-option-1"]');
    await employeeOption.trigger("click");
    expect(employeeOption.classes()).toContain("is-selected");
    expect(wrapper.get('[data-testid="operation-log-employee"]').text()).toContain("选择员工");
    expect(wrapper.find('[data-testid="operation-log-scope-next"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="confirm-operation-log-scope"]').text()).toBe("确认");
    await wrapper.get('[data-testid="confirm-operation-log-scope"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-employee"]').text()).toContain("张三");
    expect(wrapper.get('[data-testid="operation-log-lab"]').text()).toContain("选择试验间");

    await wrapper.get('[data-testid="operation-log-lab"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-lab-step"]').exists()).toBe(true);
    expect(wrapper.find('[data-testid="operation-log-employee-step"]').exists()).toBe(false);
    const labOption = wrapper.get('[data-testid="operation-log-lab-option-冲击一室"]');
    await labOption.trigger("click");
    expect(labOption.classes()).toContain("is-selected");
    await wrapper.get('[data-testid="confirm-operation-log-scope"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-employee"]').text()).toContain("张三");
    expect(wrapper.get('[data-testid="operation-log-lab"]').text()).toContain("冲击一室");
  });

  test("supports select all, clear, and cancel rollback in independent work-log selectors", async () => {
    stubAttendanceFetch();
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="open-employee-operation-logs"]').trigger("click");
    await wrapper.get('[data-testid="operation-log-employee"]').trigger("click");

    await wrapper.get('[data-testid="operation-log-employee-select-all"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-employee-option-1"]').classes()).toContain("is-selected");
    await wrapper.get('[data-testid="operation-log-employee-clear"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-employee-option-1"]').classes()).not.toContain("is-selected");

    await wrapper.get('[data-testid="operation-log-employee-option-1"]').trigger("click");
    await wrapper.get('[data-testid="confirm-operation-log-scope"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-employee"]').text()).toContain("张三");

    await wrapper.get('[data-testid="operation-log-lab"]').trigger("click");
    await wrapper.get('[data-testid="operation-log-lab-select-all"]').trigger("click");
    expect(wrapper.findAll(".system-operation-scope-option.is-selected").length).toBeGreaterThan(1);
    await wrapper.get('[data-testid="operation-log-lab-clear"]').trigger("click");
    expect(wrapper.findAll(".system-operation-scope-option.is-selected")).toHaveLength(0);
    await wrapper.get('[data-testid="operation-log-lab-option-冲击一室"]').trigger("click");
    await wrapper.get('[data-testid="confirm-operation-log-scope"]').trigger("click");

    expect(wrapper.get('[data-testid="operation-log-employee"]').text()).toContain("张三");
    expect(wrapper.get('[data-testid="operation-log-lab"]').text()).toContain("冲击一室");
    await wrapper.get('[data-testid="operation-log-employee"]').trigger("click");
    await wrapper.get('[data-testid="operation-log-employee-option-1"]').trigger("click");
    await wrapper.get('[data-testid="cancel-operation-log-scope"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-employee"]').text()).toContain("张三");

    await wrapper.get('[data-testid="operation-log-lab"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-lab-step"]').exists()).toBe(true);
  });

  test("paginates the employee work-log selector with ten employees per page", async () => {
    const employees = stubAttendanceFetch();
    for (let index = 2; index <= 23; index += 1) {
      employees.push({
        ...employees[0],
        employeeName: `员工${index}`,
        id: index,
        username: `employee${index}`,
      });
    }
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="open-employee-operation-logs"]').trigger("click");
    await wrapper.get('[data-testid="operation-log-employee"]').trigger("click");

    expect(wrapper.findAll('[data-testid^="operation-log-employee-option-"]')).toHaveLength(10);
    expect(wrapper.get('[data-testid="operation-log-employee-pagination-range"]').text()).toContain("1–10");
    expect(wrapper.get('[data-testid="operation-log-employee-pagination"] [data-testid="pagination-status"]').text()).toContain("1 / 3");

    await wrapper.get('[data-testid="operation-log-employee-pagination"] [data-page="next"]').trigger("click");

    expect(wrapper.findAll('[data-testid^="operation-log-employee-option-"]')).toHaveLength(10);
    expect(wrapper.get('[data-testid="operation-log-employee-pagination-range"]').text()).toContain("11–20");
    expect(wrapper.get('[data-testid="operation-log-employee-option-11"]').exists()).toBe(true);
  });

  test("displays employee operation log timestamps as Beijing local time without timezone markers", async () => {
    const employees = stubAttendanceFetch();
    fetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/attendance/work-times")) {
        return { ok: true, json: async () => employees };
      }
      if (url.includes("/api/attendance/operation-logs/query")) {
        return {
          ok: true,
          json: async () => [
            {
              action: "试验间退出",
              employeeName: "张三",
              id: 1,
              labName: "振动一室",
              operatedAt: "2026-07-23T09:14:44+08:00",
              source: "manual",
              username: "zhangsan",
            },
            {
              action: "完成试验",
              employeeName: "张三",
              id: 2,
              labName: "振动一室",
              operatedAt: "2026-07-23T01:14:41Z",
              source: "mqtt",
              username: "zhangsan",
            },
          ],
        };
      }
      if (url.includes("/api/attendance/users")) {
        return { ok: true, json: async () => [] };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="open-employee-operation-logs"]').trigger("click");
    await wrapper.get('[data-testid="query-employee-operation-logs"]').trigger("click");
    await flushPromises();

    const tableText = wrapper.get('[data-testid="employee-operation-logs-table"]').text();
    expect(tableText).toContain("2026-07-23 09:14:44");
    expect(tableText).toContain("2026-07-23 09:14:41");
    expect(tableText).not.toContain("+08:00");
    expect(tableText).not.toContain("T09:14");
  });

  test("updates active employee work time every second without refreshing the page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T08:15:00Z"));
    const employees = stubAttendanceFetch();
    employees[0] = {
      ...employees[0],
      activeWorkIntervalCount: 1,
      calculatedAt: "2026-07-02T08:15:00Z",
      todaySeconds: 9300,
    };

    const wrapper = mount(SystemPage);
    await flushPromises();

    expect(wrapper.get("#employee-worktime-table").text()).toContain("2小时35分0秒");

    vi.advanceTimersByTime(2000);
    await nextTick();

    expect(wrapper.get("#employee-worktime-table").text()).toContain("2小时35分2秒");
  });

  test("opens and closes the employee account modal from Vue state", async () => {
    stubAttendanceFetch();
    const wrapper = mount(SystemPage);
    await flushPromises();

    expect(wrapper.find(".modal.is-open").exists()).toBe(false);

    await wrapper.get('[data-testid="open-employee-modal"]').trigger("click");

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("新增员工账号");
    expect(wrapper.find('[data-testid="employee-role-select"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="employee-role-select"] option').map((option) => option.text())).toEqual(["试验员", "试验组长"]);
    expect(wrapper.text()).not.toContain("可登录试验间");

    await wrapper.get(".modal-close").trigger("click");

    expect(wrapper.find(".modal.is-open").exists()).toBe(false);
  });

  test("creates an employee account and refreshes the table without laboratory permissions", async () => {
    const employees = stubAttendanceFetch();
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/attendance/users") && (options.method || "GET") === "POST") {
        const body = JSON.parse(String(options.body || "{}"));
        employees.push({
          active: true,
          allowedLabs: ["*"],
          currentLabName: "",
          employeeName: body.employeeName,
          id: 2,
          lastLoginAt: "",
          online: false,
          roleName: body.roleName,
          todaySeconds: 0,
          username: body.username,
        });
        return { ok: true, json: async () => employees.at(-1) };
      }
      if (url.includes("/api/attendance/work-times")) {
        return { ok: true, json: async () => employees };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="open-employee-modal"]').trigger("click");
    await wrapper.get('[data-testid="employee-name-input"]').setValue("王五");
    await wrapper.get('[data-testid="employee-username-input"]').setValue("wangwu");
    await wrapper.get('[data-testid="employee-password-input"]').setValue("pw123");
    await wrapper.get('[data-testid="employee-role-select"]').setValue("试验组长");
    await wrapper.get('[data-testid="employee-save"]').trigger("click");
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith("/api/attendance/users", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        username: "wangwu",
        password: "pw123",
        employeeName: "王五",
        roleName: "试验组长",
        active: true,
      }),
    }));
    expect(wrapper.find(".modal.is-open").exists()).toBe(false);
    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(2);
    expect(wrapper.text()).toContain("王五");
    expect(wrapper.text()).toContain("试验组长");
  });

  test("shows a duplicate username prompt and keeps the create modal open", async () => {
    stubAttendanceFetch();
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/attendance/users") && (options.method || "GET") === "POST") {
        return {
          ok: false,
          status: 409,
          json: async () => ({ detail: "Employee username already exists" }),
        };
      }
      if (url.includes("/api/attendance/work-times")) {
        return { ok: true, json: async () => [] };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="open-employee-modal"]').trigger("click");
    await wrapper.get('[data-testid="employee-name-input"]').setValue("重复员工");
    await wrapper.get('[data-testid="employee-username-input"]').setValue("zhangsan");
    await wrapper.get('[data-testid="employee-password-input"]').setValue("pw123");
    await wrapper.get('[data-testid="employee-save"]').trigger("click");
    await flushPromises();

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.get('[data-testid="employee-create-error"]').text()).toContain("账号已存在");
    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(2);
  });

  test("opens employee edit as a center modal and filters visible employees", async () => {
    stubAttendanceFetch();
    const wrapper = mount(SystemPage);
    await flushPromises();

    expect(wrapper.find(".drawer.is-open").exists()).toBe(false);
    expect(wrapper.find(".modal.is-open").exists()).toBe(false);
    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(1);

    await wrapper.get('input[placeholder="筛选员工/账号/角色"]').setValue("张三");

    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(1);
    expect(wrapper.text()).toContain("张三");

    await wrapper.get('[data-testid="open-employee-drawer-0"]').trigger("click");

    expect(wrapper.find(".drawer.is-open").exists()).toBe(false);
    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.text()).toContain("员工账号详情");
  });

  test("requires administrator credentials to reset password and delete an employee", async () => {
    const employees = stubAttendanceFetch();
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/attendance/work-times")) {
        return { ok: true, json: async () => employees };
      }
      if (url.includes("/api/attendance/users/1/password/reset")) {
        return { ok: true, json: async () => ({ ok: true }) };
      }
      if (url.includes("/api/attendance/users/1") && (options.method || "GET") === "DELETE") {
        employees.splice(0, 1);
        return { ok: true, json: async () => ({ deleted: true }) };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="open-employee-drawer-0"]').trigger("click");
    expect(wrapper.get('[data-testid="admin-username-input"]').element.value).toBe("admin");
    expect(wrapper.get('[data-testid="admin-password-input"]').element.value).toBe("123");
    await wrapper.get('[data-testid="admin-username-input"]').setValue("admin");
    await wrapper.get('[data-testid="admin-password-input"]').setValue("123");
    await wrapper.get('[data-testid="reset-password-input"]').setValue("new-password");
    expect(wrapper.get('[data-testid="employee-delete"]').text()).toBe("删除账号");
    await wrapper.get('[data-testid="employee-reset-password"]').trigger("click");
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith("/api/attendance/users/1/password/reset", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        adminUsername: "admin",
        adminPassword: "123",
        newPassword: "new-password",
      }),
    }));
    expect(wrapper.get('[data-testid="employee-admin-action-feedback"]').text()).toContain("密码已重置");
    expect(wrapper.get('[data-testid="reset-password-input"]').element.value).toBe("");

    await wrapper.get('[data-testid="employee-delete"]').trigger("click");
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith("/api/attendance/users/1", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({
        adminUsername: "admin",
        adminPassword: "123",
      }),
    }));
    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(0);
  });

  test("shows administrator action errors without closing the employee modal", async () => {
    const employees = stubAttendanceFetch();
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/attendance/work-times")) {
        return { ok: true, json: async () => employees };
      }
      if (url.includes("/api/attendance/users/1/password/reset")) {
        return {
          ok: false,
          status: 401,
          json: async () => ({ detail: "Invalid administrator credentials" }),
        };
      }
      if (url.includes("/api/attendance/users/1") && (options.method || "GET") === "DELETE") {
        return {
          ok: false,
          status: 401,
          json: async () => ({ detail: "Invalid administrator credentials" }),
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="open-employee-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="admin-username-input"]').setValue("bad-admin");
    await wrapper.get('[data-testid="admin-password-input"]').setValue("wrong");
    await wrapper.get('[data-testid="reset-password-input"]').setValue("new-password");
    await wrapper.get('[data-testid="employee-reset-password"]').trigger("click");
    await flushPromises();

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.get('[data-testid="employee-admin-action-feedback"]').text()).toContain("Invalid administrator credentials");
    expect(wrapper.get('[data-testid="reset-password-input"]').element.value).toBe("new-password");

    await wrapper.get('[data-testid="employee-delete"]').trigger("click");
    await flushPromises();

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(1);
    expect(wrapper.get('[data-testid="employee-admin-action-feedback"]').text()).toContain("Invalid administrator credentials");
  });

  test("generates an employee QR code from the personnel management table", async () => {
    const employees = stubAttendanceFetch();
    fetch.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/api/attendance/work-times")) {
        return { ok: true, json: async () => employees };
      }
      if (url.includes("/api/attendance/users/1/qr-token/reset")) {
        return {
          ok: true,
          json: async () => ({
            ok: true,
            qrPayload: "MES-ATTENDANCE:QR:test-token-001",
            qrToken: "test-token-001",
            user: {
              active: true,
              allowedLabs: ["*"],
              employeeName: "张三",
              hasQrToken: true,
              id: 1,
              qrTokenCreatedAt: "2026-07-02T16:20:00+08:00",
              roleName: "试验员",
              username: "zhangsan",
            },
          }),
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="employee-qr-code-0"]').trigger("click");
    expect(wrapper.find('[data-testid="employee-qr-admin-username"]').exists()).toBe(false);
    expect(wrapper.find('[data-testid="employee-qr-admin-password"]').exists()).toBe(false);
    await wrapper.get('[data-testid="employee-qr-reset"]').trigger("click");
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith("/api/attendance/users/1/qr-token/reset", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({}),
    }));
    expect(wrapper.get('[data-testid="employee-qr-modal"]').text()).toContain("张三");
    expect(wrapper.get('[data-testid="employee-qr-payload"]').text()).toContain("MES-ATTENDANCE:QR:test-token-001");
    expect(wrapper.get("#employee-worktime-table").text()).toContain("冲击一室");
  });

  test("opens an existing employee QR code without resetting it", async () => {
    const employees = stubAttendanceFetch();
    employees[0] = {
      ...employees[0],
      hasQrToken: true,
      qrTokenCreatedAt: "2026-07-02T16:20:00+08:00",
    };
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/attendance/work-times")) {
        return { ok: true, json: async () => employees };
      }
      if (url.includes("/api/attendance/users/1/qr-token") && (options.method || "GET") === "GET") {
        return {
          ok: true,
          json: async () => ({
            qrPayload: "MES-ATTENDANCE:QR:existing-token-001",
            user: employees[0],
          }),
        };
      }
      if (url.includes("/api/attendance/users/1/qr-token/reset")) {
        throw new Error("QR code should not reset when opening the modal");
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="employee-qr-code-0"]').trigger("click");
    await flushPromises();

    expect(fetch).toHaveBeenCalledWith("/api/attendance/users/1/qr-token", expect.objectContaining({
      credentials: "include",
      headers: { Accept: "application/json" },
    }));
    expect(wrapper.get('[data-testid="employee-qr-modal"]').text()).toContain("已生成");
    expect(wrapper.get('[data-testid="employee-qr-payload"]').text()).toContain("MES-ATTENDANCE:QR:existing-token-001");
    expect(wrapper.get('[data-testid="employee-qr-reset"]').text()).toContain("重置二维码");
  });

  test("downloads the displayed employee QR code as an image", async () => {
    const employees = stubAttendanceFetch();
    employees[0] = {
      ...employees[0],
      hasQrToken: true,
      qrTokenCreatedAt: "2026-07-02T16:20:00+08:00",
    };
    fetch.mockImplementation(async (input, options = {}) => {
      const url = String(input);
      if (url.includes("/api/attendance/work-times")) {
        return { ok: true, json: async () => employees };
      }
      if (url.includes("/api/attendance/users/1/qr-token") && (options.method || "GET") === "GET") {
        return {
          ok: true,
          json: async () => ({
            qrPayload: "MES-ATTENDANCE:QR:existing-token-001",
            user: employees[0],
          }),
        };
      }
      throw new Error(`Unhandled fetch: ${url}`);
    });
    const createdLinks = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName, options) => {
      const element = originalCreateElement(tagName, options);
      if (String(tagName).toLowerCase() === "a") {
        element.click = vi.fn();
        createdLinks.push(element);
      }
      return element;
    });
    const wrapper = mount(SystemPage);
    await flushPromises();

    await wrapper.get('[data-testid="employee-qr-code-0"]').trigger("click");
    await flushPromises();
    const downloadButton = wrapper.get('[data-testid="employee-qr-download"]');
    expect(downloadButton.attributes("disabled")).toBeUndefined();
    await downloadButton.trigger("click");
    await flushPromises();

    expect(createdLinks).toHaveLength(1);
    expect(createdLinks[0].download).toBe("zhangsan-qr-code.svg");
    expect(createdLinks[0].href).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(createdLinks[0].click).toHaveBeenCalledTimes(1);
  });
});
