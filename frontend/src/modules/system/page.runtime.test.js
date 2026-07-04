import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import SystemPage from "./page.vue";

describe("SystemPage runtime", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const stubAttendanceFetch = () => {
    const employees = [
      {
        active: true,
        allowedLabs: ["*"],
        currentLabName: "冲击一室",
        employeeName: "张三",
        id: 1,
        lastLoginAt: "2026-07-02T08:15:00Z",
        online: true,
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

  test("renders personnel maintenance with a work-time overview before base settings", async () => {
    stubAttendanceFetch();
    const wrapper = mount(SystemPage);
    await flushPromises();
    const pageText = wrapper.text();

    expect(pageText).toContain("人员信息维护");
    expect(pageText).toContain("人员工作时间一览表");
    expect(pageText.indexOf("人员工作时间一览表")).toBeLessThan(pageText.indexOf("基础配置"));
    expect(pageText).not.toContain("角色权限矩阵");
    expect(pageText).toContain("张三");
    expect(pageText).toContain("zhangsan");
    expect(pageText).toContain("2小时35分0秒");
    expect(pageText).toContain("冲击一室");
    expect(pageText).not.toContain("可登录试验间");
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
});
