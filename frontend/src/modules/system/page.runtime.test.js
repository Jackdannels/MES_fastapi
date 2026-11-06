import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { afterEach, describe, expect, test, vi } from "vitest";

import SystemPage from "./page.vue";
import PickerOnlyInput from "@/components/shared/PickerOnlyInput.vue";

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

  test("provides native employee sorting controls with announced sort order", async () => {
    stubAttendanceFetch();
    const wrapper = mount(SystemPage);
    await flushPromises();
    const header = wrapper.get("#employee-table th[data-sort]");
    const sortButton = header.get("button.table-sort-button");
    expect(header.attributes("aria-sort")).toBe("none");
    expect(sortButton.attributes("type")).toBe("button");
    await sortButton.trigger("click");
    expect(header.attributes("aria-sort")).toBe("ascending");
    await sortButton.trigger("click");
    expect(header.attributes("aria-sort")).toBe("descending");
    wrapper.unmount();
  });

  test("groups employee details, administrator verification and password reset without dropping controls", async () => {
    stubAttendanceFetch();
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="open-employee-drawer-0"]').trigger("click");
    expect(wrapper.findAll(".system-employee-section legend").map((legend) => legend.text())).toEqual(["员工资料", "管理员身份验证", "修改密码"]);
    expect(wrapper.findAll(".system-employee-section input, .system-employee-section select")).toHaveLength(6);
    expect(wrapper.get("#employee-new-password").element.labels[0].textContent).toContain("留空则不修改");
    expect(wrapper.findAll(".system-employee-edit-modal .form-actions button")).toHaveLength(3);
    wrapper.unmount();
  });

  test("distinguishes unqueried, loading, empty, failed and changed work-log filters", async () => {
    stubAttendanceFetch();
    const initialFetch = fetch.getMockImplementation();
    let resolveQuery;
    fetch.mockImplementation((input, options) => String(input).includes("/operation-logs/query")
      ? new Promise((resolve) => { resolveQuery = resolve; })
      : initialFetch(input, options));
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="open-employee-operation-logs"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-empty"]').text()).toContain("尚未查询");
    expect(wrapper.get('[data-testid="operation-log-employee"]').text()).toBe("全部员工");
    expect(wrapper.get('[data-testid="operation-log-lab"]').text()).toBe("全部试验间");
    for (const id of ["operation-log-admin-username", "operation-log-admin-password", "operation-log-date", "operation-log-employee", "operation-log-lab"]) {
      expect(wrapper.get(`#${id}`).element.labels.length).toBe(1);
    }
    await wrapper.get('[data-testid="query-employee-operation-logs"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-empty"]').text()).toContain("正在查询");
    expect(wrapper.get('[data-testid="query-employee-operation-logs"]').attributes("disabled")).toBeDefined();
    resolveQuery({ ok: true, json: async () => [] });
    await flushPromises(8);
    expect(wrapper.get('[data-testid="operation-log-empty"]').text()).toContain("没有匹配");
    await wrapper.get('[data-testid="operation-log-admin-username"]').setValue("another-admin");
    expect(wrapper.get('[data-testid="operation-log-empty"]').text()).toContain("尚未查询");
    await wrapper.get('[data-testid="query-employee-operation-logs"]').trigger("click");
    resolveQuery({ ok: false, status: 401, json: async () => ({ detail: "管理员账号或密码错误" }) });
    await flushPromises(8);
    expect(wrapper.get('[data-testid="operation-log-empty"]').text()).toContain("查询未成功");
    wrapper.unmount();
  });

  test("discards pending work-log responses after filters change or the dialog is reopened", async () => {
    stubAttendanceFetch();
    const initialFetch = fetch.getMockImplementation();
    const queries = [];
    fetch.mockImplementation((input, options) => String(input).includes("/operation-logs/query")
      ? new Promise((resolve) => { queries.push(resolve); })
      : initialFetch(input, options));
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="open-employee-operation-logs"]').trigger("click");
    await wrapper.get('[data-testid="query-employee-operation-logs"]').trigger("click");

    wrapper.findComponent(PickerOnlyInput).vm.$emit("update:modelValue", "2026-07-25");
    await nextTick();
    expect(wrapper.get('[data-testid="operation-log-empty"]').text()).toContain("尚未查询");
    expect(wrapper.get('[data-testid="query-employee-operation-logs"]').attributes("disabled")).toBeUndefined();
    await wrapper.get('[data-testid="query-employee-operation-logs"]').trigger("click");
    queries[0]({ ok: true, json: async () => [{ id: 900, action: "旧范围结果" }] });
    await flushPromises(8);
    expect(wrapper.get('[data-testid="operation-log-empty"]').text()).toContain("正在查询");
    expect(wrapper.get('[data-testid="employee-operation-logs-table"]').text()).not.toContain("旧范围结果");
    expect(wrapper.get('[data-testid="query-employee-operation-logs"]').attributes("disabled")).toBeDefined();
    queries[1]({ ok: true, json: async () => [] });
    await flushPromises(8);
    expect(wrapper.get('[data-testid="operation-log-empty"]').text()).toContain("没有匹配");

    await wrapper.get('[data-testid="query-employee-operation-logs"]').trigger("click");
    await wrapper.get(".system-operation-log-modal .modal-close").trigger("click");
    await wrapper.get('[data-testid="open-employee-operation-logs"]').trigger("click");
    queries[2]({ ok: true, json: async () => [{ id: 901, action: "上次弹窗结果" }] });
    await flushPromises(8);
    expect(wrapper.get('[data-testid="operation-log-empty"]').text()).toContain("尚未查询");
    expect(wrapper.get('[data-testid="employee-operation-logs-table"]').text()).not.toContain("上次弹窗结果");
    wrapper.unmount();
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

  test("explains an unmatched employee filter and restores the first page when it is cleared", async () => {
    const employees = stubAttendanceFetch();
    for (let id = 2; id <= 11; id += 1) {
      employees.push({ ...employees[0], id, employeeName: `员工${id}`, username: `employee${id}` });
    }
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="employee-pagination"] [data-page="next"]').trigger("click");
    expect(wrapper.get('[data-testid="employee-pagination-range"]').text()).toContain("9–11");

    await wrapper.get('input[placeholder="筛选员工/账号/角色"]').setValue("没有这位员工");
    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(0);
    const empty = wrapper.get('[data-testid="employee-empty-state"]');
    expect(empty.attributes("role")).toBe("status");
    expect(empty.text()).toContain("没有匹配的员工");
    expect(empty.text()).toContain("没有这位员工");
    expect(wrapper.findAll("#employee-worktime-table tbody tr")).toHaveLength(8);

    const focusSearch = vi.spyOn(wrapper.get('input[placeholder="筛选员工/账号/角色"]').element, "focus");
    await wrapper.get('[data-testid="employee-clear-query"]').trigger("click");
    expect(focusSearch).toHaveBeenCalledOnce();
    expect(wrapper.get('input[placeholder="筛选员工/账号/角色"]').element.value).toBe("");
    expect(wrapper.find('[data-testid="employee-empty-state"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="employee-pagination-range"]').text()).toContain("1–8");
    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(8);
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
    expect(wrapper.get('[data-testid="operation-log-employee"]').text()).toContain("全部员工");
    expect(wrapper.find('[data-testid="operation-log-scope-next"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="confirm-operation-log-scope"]').text()).toBe("确认");
    await wrapper.get('[data-testid="confirm-operation-log-scope"]').trigger("click");
    expect(wrapper.get('[data-testid="operation-log-employee"]').text()).toContain("张三");
    expect(wrapper.get('[data-testid="operation-log-lab"]').text()).toContain("全部试验间");

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
    expect(wrapper.get('[data-testid="create-employee-admin-username"]').element.value).toBe("admin");
    expect(wrapper.get('[data-testid="create-employee-admin-password"]').element.value).toBe("123");
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
        adminUsername: "admin",
        adminPassword: "123",
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

  test("validates create admin input, preserves rejected form, and resets credentials on reopen", async () => {
    const employees = stubAttendanceFetch();
    fetch.mockImplementation(async (input, options = {}) => options.method === "POST"
      ? { ok: false, status: 401, json: async () => ({ detail: "管理员账号或密码错误" }) }
      : { ok: true, json: async () => employees });
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="open-employee-modal"]').trigger("click");
    await wrapper.get('[data-testid="employee-name-input"]').setValue("新员工");
    await wrapper.get('[data-testid="employee-username-input"]').setValue("new-worker");
    await wrapper.get('[data-testid="employee-password-input"]').setValue("employee-password");
    await wrapper.get('[data-testid="create-employee-admin-password"]').setValue("");
    await wrapper.get('[data-testid="employee-save"]').trigger("click");
    expect(wrapper.get('[data-testid="employee-create-error"]').text()).toContain("请输入管理员账号和密码");
    expect(fetch.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
    await wrapper.get('[data-testid="create-employee-admin-username"]').setValue("bad-admin");
    await wrapper.get('[data-testid="create-employee-admin-password"]').setValue("wrong");
    await wrapper.get('[data-testid="employee-save"]').trigger("click");
    await flushPromises(10);
    expect(wrapper.get('[data-testid="employee-create-error"]').text()).toContain("管理员账号或密码错误");
    expect(wrapper.get('[data-testid="employee-name-input"]').element.value).toBe("新员工");
    expect(wrapper.get('[data-testid="employee-password-input"]').element.value).toBe("employee-password");
    expect(wrapper.get('[data-testid="employee-save"]').element.disabled).toBe(false);
    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(1);
    const posted = fetch.mock.calls.find(([, options]) => options?.method === "POST");
    expect(JSON.parse(posted[1].body)).toMatchObject({ adminUsername: "bad-admin", adminPassword: "wrong" });
    await wrapper.get(".modal-close").trigger("click");
    await wrapper.get('[data-testid="open-employee-modal"]').trigger("click");
    expect(wrapper.get('[data-testid="create-employee-admin-username"]').element.value).toBe("admin");
    expect(wrapper.get('[data-testid="create-employee-admin-password"]').element.value).toBe("123");
    expect(wrapper.get('[data-testid="employee-name-input"]').element.value).toBe("");
    expect(wrapper.find('[data-testid="employee-create-error"]').exists()).toBe(false);
    wrapper.unmount();
  });

  test("disables duplicate creation and releases the form after the request settles", async () => {
    const employees = stubAttendanceFetch();
    let resolveCreate;
    fetch.mockImplementation(async (input, options = {}) => options.method === "POST"
      ? new Promise((resolve) => { resolveCreate = resolve; })
      : { ok: true, json: async () => employees });
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="open-employee-modal"]').trigger("click");
    await wrapper.get('[data-testid="employee-name-input"]').setValue("新员工");
    await wrapper.get('[data-testid="employee-save"]').trigger("click");
    expect(wrapper.get('[data-testid="employee-save"]').text()).toBe("保存中…");
    expect(wrapper.get('[data-testid="employee-save"]').element.disabled).toBe(true);
    expect(wrapper.get("fieldset.system-employee-fields").element.disabled).toBe(true);
    await wrapper.get('[data-testid="employee-save"]').trigger("click");
    await wrapper.get(".modal-close").trigger("click");
    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(fetch.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    resolveCreate({ ok: false, status: 401, json: async () => ({ detail: "管理员账号或密码错误" }) });
    await flushPromises(10);
    expect(wrapper.get('[data-testid="employee-save"]').element.disabled).toBe(false);
    expect(wrapper.get("fieldset.system-employee-fields").element.disabled).toBe(false);
    wrapper.unmount();
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

  test("saves employee details with administrator verification and leaves an omitted password unchanged", async () => {
    const employees = stubAttendanceFetch();
    let completeSave;
    fetch.mockImplementation(async (input, options = {}) => {
      if (options.method === "PUT") {
        return new Promise((resolve) => { completeSave = resolve; });
      }
      return { ok: true, json: async () => employees };
    });
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="open-employee-drawer-0"]').trigger("click");
    const save = wrapper.get('[data-testid="employee-save-changes"]');
    expect(save.element.disabled).toBe(true);
    const actions = wrapper.findAll(".system-employee-edit-modal .form-actions button");
    expect(actions.map((button) => button.text())).toEqual(["重置密码", "保存修改", "删除账号"]);
    await wrapper.get('[data-testid="admin-password-input"]').setValue("123");
    expect(save.element.disabled).toBe(true);
    for (const [selector, changed, original] of [
      ["edit-employee-name", "张四", "张三"],
      ["edit-employee-username", "zhangsi", "zhangsan"],
      ["edit-employee-role", "试验组长", "试验员"],
    ]) {
      await wrapper.get(`[data-testid="${selector}"]`).setValue(changed);
      expect(save.element.disabled).toBe(false);
      await wrapper.get(`[data-testid="${selector}"]`).setValue(original);
      expect(save.element.disabled).toBe(true);
    }
    await wrapper.get('[data-testid="edit-employee-name"]').setValue("张四");
    await wrapper.get('[data-testid="edit-employee-username"]').setValue("zhangsi");
    await wrapper.get('[data-testid="edit-employee-role"]').setValue("试验组长");
    await save.trigger("click");
    expect(save.text()).toBe("保存中…");
    expect(save.element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="employee-reset-password"]').element.disabled).toBe(true);
    const request = fetch.mock.calls.find(([, options]) => options?.method === "PUT");
    expect(request[0]).toBe("/api/attendance/users/1");
    expect(JSON.parse(request[1].body)).toEqual({
      adminUsername: "admin", adminPassword: "123", employeeName: "张四", username: "zhangsi", roleName: "试验组长",
    });
    completeSave({ ok: true, json: async () => ({ ...employees[0], employeeName: "张四", username: "zhangsi", roleName: "试验组长" }) });
    await flushPromises(10);
    expect(save.element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="employee-admin-action-feedback"]').text()).toContain("员工信息已保存");
    expect(wrapper.get("#employee-table").text()).toContain("张四");
    expect(wrapper.get("#employee-worktime-table").text()).toContain("zhangsi");
    expect(wrapper.get("#employee-worktime-table").text()).toContain("2小时35分0秒");
    expect(wrapper.get('[data-testid="admin-password-input"]').element.value).toBe("123");
    wrapper.unmount();
  });

  test.each([false, true])("saves a new password with the save-changes button (profile edited: %s)", async (editProfile) => {
    const employees = stubAttendanceFetch();
    fetch.mockImplementation(async (input, options = {}) => {
      if (options.method === "PUT") {
        return { ok: true, json: async () => ({ ...employees[0], employeeName: editProfile ? "张四" : "张三" }) };
      }
      return { ok: true, json: async () => employees };
    });
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="open-employee-drawer-0"]').trigger("click");
    const save = wrapper.get('[data-testid="employee-save-changes"]');
    expect(save.element.disabled).toBe(true);
    await wrapper.get('[data-testid="reset-password-input"]').setValue(" new-password ");
    expect(save.element.disabled).toBe(false);
    if (editProfile) {
      await wrapper.get('[data-testid="edit-employee-name"]').setValue("张四");
    }
    await save.trigger("click");
    await flushPromises(10);

    const writes = fetch.mock.calls.filter(([, options]) => options?.method === "PUT" || options?.method === "POST");
    expect(writes).toHaveLength(1);
    expect(writes[0][0]).toBe("/api/attendance/users/1");
    expect(JSON.parse(writes[0][1].body)).toEqual({
      adminUsername: "admin", adminPassword: "123", employeeName: editProfile ? "张四" : "张三",
      username: "zhangsan", roleName: "试验员", password: " new-password ",
    });
    expect(wrapper.get('[data-testid="employee-admin-action-feedback"]').text()).toContain("员工信息及密码已保存");
    expect(wrapper.get('[data-testid="reset-password-input"]').element.value).toBe("");
    expect(save.element.disabled).toBe(true);
    wrapper.unmount();
  });

  test("rejects a whitespace-only new password without saving employee edits", async () => {
    stubAttendanceFetch();
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="open-employee-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="edit-employee-name"]').setValue("张四");
    await wrapper.get('[data-testid="reset-password-input"]').setValue("   ");
    await wrapper.get('[data-testid="employee-save-changes"]').trigger("click");
    expect(wrapper.get('[data-testid="employee-admin-action-feedback"]').text()).toContain("新密码不能仅包含空白字符");
    expect(fetch.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
    expect(wrapper.get("#employee-table").text()).toContain("张三");
    wrapper.unmount();
  });

  test("failed saves keep edits and require administrator input", async () => {
    const employees = stubAttendanceFetch();
    fetch.mockImplementation(async (input, options = {}) => options.method === "PUT"
      ? { ok: false, status: 401, json: async () => ({ detail: "Invalid administrator credentials" }) }
      : { ok: true, json: async () => employees });
    const wrapper = mount(SystemPage);
    await flushPromises();
    await wrapper.get('[data-testid="open-employee-drawer-0"]').trigger("click");
    await wrapper.get('[data-testid="edit-employee-role"]').setValue("试验组长");
    await wrapper.get('[data-testid="reset-password-input"]').setValue("new-password");
    await wrapper.get('[data-testid="admin-password-input"]').setValue("");
    await wrapper.get('[data-testid="employee-save-changes"]').trigger("click");
    expect(wrapper.text()).toContain("请输入管理员账号和密码");
    expect(fetch.mock.calls.some(([, options]) => options?.method === "PUT")).toBe(false);
    await wrapper.get('[data-testid="admin-password-input"]').setValue("wrong");
    await wrapper.get('[data-testid="employee-save-changes"]').trigger("click");
    await flushPromises(10);
    expect(wrapper.text()).toContain("管理员账号或密码错误");
    expect(wrapper.get('[data-testid="edit-employee-role"]').element.value).toBe("试验组长");
    expect(wrapper.get('[data-testid="reset-password-input"]').element.value).toBe("new-password");
    expect(wrapper.get('[data-testid="employee-save-changes"]').element.disabled).toBe(false);
    expect(wrapper.get("#employee-table").text()).not.toContain("试验组长");
    await wrapper.get(".system-employee-edit-modal .modal-close").trigger("click");
    await wrapper.get('[data-testid="open-employee-drawer-0"]').trigger("click");
    expect(wrapper.get('[data-testid="edit-employee-role"]').element.value).toBe("试验员");
    expect(wrapper.get('[data-testid="reset-password-input"]').element.value).toBe("");
    expect(wrapper.get('[data-testid="employee-save-changes"]').element.disabled).toBe(true);
    wrapper.unmount();
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
    expect(wrapper.get('[data-testid="employee-admin-action-feedback"]').text()).toContain("管理员账号或密码错误");
    expect(wrapper.get('[data-testid="reset-password-input"]').element.value).toBe("new-password");

    await wrapper.get('[data-testid="employee-delete"]').trigger("click");
    await flushPromises();

    expect(wrapper.find(".modal.is-open").exists()).toBe(true);
    expect(wrapper.findAll("#employee-table tbody tr")).toHaveLength(1);
    expect(wrapper.get('[data-testid="employee-admin-action-feedback"]').text()).toContain("管理员账号或密码错误");
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
