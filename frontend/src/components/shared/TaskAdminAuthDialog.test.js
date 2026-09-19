import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";
import TaskAdminAuthDialog from "./TaskAdminAuthDialog.vue";
import { taskAdminAuthState as state, cancelTaskAdminAction } from "@/lib/taskAdminAuth";
import { acceptExternalTaskIntake, createTask, deleteTask, updateTask } from "@/lib/tasksApi";

describe("任务管理员认证弹窗", () => {
  let wrapper;
  beforeEach(() => {
    Object.assign(state, { adminUsername: "admin", adminPassword: "123", submitting: false });
    cancelTaskAdminAction();
    wrapper = mount(TaskAdminAuthDialog, { attachTo: document.body, global: { stubs: { teleport: true } } });
  });
  afterEach(() => {
    wrapper.unmount();
    vi.unstubAllGlobals();
  });

  test.each([
    ["确认新增", () => createTask({ code: "TASK-NEW" }), "POST", "/api/tasks"],
    ["确认受理", () => acceptExternalTaskIntake("intake-1"), "POST", "/api/tasks/external-intakes/intake-1/accept"],
    ["保存任务修改", () => updateTask("task-1", { name: "新名称" }), "PUT", "/api/tasks/task-1"],
    ["删除任务", () => deleteTask("task-1"), "DELETE", "/api/tasks/task-1"],
  ])("%s：认证前不请求，认证失败不执行，通过后仅执行一次", async (label, action, method, url) => {
    let writes = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
      if (options.headers["X-Admin-Password"] !== "123") {
        return { ok: false, status: 401, json: async () => ({ detail: "管理员账号或密码错误" }) };
      }
      writes += 1;
      return { ok: true, status: method === "DELETE" ? 204 : 200, json: async () => ({ id: "saved" }) };
    }));
    let settled = false;
    const pending = action().finally(() => { settled = true; });
    await flushPromises();
    expect(wrapper.text()).toContain(label);
    expect(fetch).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="task-admin-username"]').element.value).toBe("admin");
    expect(wrapper.get('[data-testid="task-admin-password"]').element.value).toBe("123");
    await wrapper.get('[data-testid="task-admin-password"]').setValue("wrong");
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.text()).toContain("管理员账号或密码错误");
    expect(writes).toBe(0);
    expect(settled).toBe(false);
    await wrapper.get('[data-testid="task-admin-password"]').setValue("123");
    await wrapper.get("form").trigger("submit");
    await pending;
    await flushPromises();
    expect(writes).toBe(1);
    expect(state.open).toBe(false);
    expect(fetch).toHaveBeenLastCalledWith(url, expect.objectContaining({
      method, headers: expect.objectContaining({ "X-Admin-Username": "admin", "X-Admin-Password": "123" }),
    }));
  });

  test("取消不写入任务，再次操作仍须认证且自动填入已保留凭据", async () => {
    vi.stubGlobal("fetch", vi.fn());
    const pending = deleteTask("task-1").catch((error) => error);
    await flushPromises();
    await wrapper.get('[data-testid="task-admin-cancel"]').trigger("click");
    expect((await pending).name).toBe("TaskAdminCancelledError");
    expect(fetch).not.toHaveBeenCalled();
    const again = deleteTask("task-2").catch((error) => error);
    await flushPromises();
    expect(state.open).toBe(true);
    expect(wrapper.get('[data-testid="task-admin-password"]').element.value).toBe("123");
    cancelTaskAdminAction();
    await again;
  });

  test("空凭据不提交，执行中防重入，发送的是打开弹窗时的任务快照", async () => {
    let complete;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { complete = resolve; })));
    const task = { code: "TASK-1", name: "原名称" };
    const pending = createTask(task);
    task.name = "后来修改";
    await flushPromises();
    await wrapper.get('[data-testid="task-admin-password"]').setValue("");
    await wrapper.get("form").trigger("submit");
    expect(fetch).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("请输入管理员账号和密码");
    await wrapper.get('[data-testid="task-admin-password"]').setValue("123");
    await wrapper.get("form").trigger("submit");
    await wrapper.get("form").trigger("submit");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="task-admin-confirm"]').element.disabled).toBe(true);
    expect(wrapper.get('[data-testid="task-admin-cancel"]').element.disabled).toBe(true);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ code: "TASK-1", name: "原名称" });
    complete({ ok: true, json: async () => ({ id: "saved" }) });
    await pending;
  });

  test("业务错误返回原表单处理，不无限重试认证", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ detail: "任务编号已存在" }) })));
    const pending = createTask({ code: "TASK-1" }).catch((error) => error);
    await flushPromises();
    await wrapper.get("form").trigger("submit");
    expect((await pending).message).toBe("任务编号已存在");
    expect(state.open).toBe(false);
  });

  test("任务受理和共用任务编辑页面均挂载认证弹窗", () => {
    for (const path of ["src/modules/tasks/page.vue", "src/modules/task-overview/page.vue"]) {
      expect(readFileSync(path, "utf8")).toContain("<TaskAdminAuthDialog />");
    }
  });
});
