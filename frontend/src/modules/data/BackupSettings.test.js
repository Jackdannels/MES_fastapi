import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, test, vi } from "vitest";
import BackupSettings from "./BackupSettings.vue";

const api = vi.hoisted(() => ({ readBackupStatus: vi.fn(), checkBackupPath: vi.fn(), saveBackupPath: vi.fn(), selectBackupDirectory: vi.fn() }));
vi.mock("@/lib/testDataBackupApi", () => api);
const oldPath = "\\\\server-a\\share\\试验数据";
const newPath = "\\\\server-b\\share\\试验数据";
const success = { ok: true, path: newPath, detail: "检测通过", checks: [{ label: "目录可达", ok: true }] };

async function page() {
  const wrapper = mount(BackupSettings);
  await flushPromises();
  return wrapper;
}

describe("BackupSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    api.readBackupStatus.mockResolvedValue({ enabled: true, destination: oldPath, counts: { synced: 24, pending: 1, failed: 0 } });
    api.checkBackupPath.mockResolvedValue(success);
    api.saveBackupPath.mockResolvedValue({ enabled: true, destination: newPath, probe: success });
    api.selectBackupDirectory.mockResolvedValue({ backupPath: newPath, cancelled: false });
  });

  test("shows effective path separately and invalidates check after input changes", async () => {
    const wrapper = await page();
    expect(wrapper.get('[data-testid="backup-current"]').text()).toBe(oldPath);
    expect(wrapper.text()).toContain("已备份 24");
    await wrapper.get("input").setValue(newPath);
    await wrapper.get('[data-testid="backup-check"]').trigger("click");
    await flushPromises();
    expect(api.checkBackupPath).toHaveBeenCalledWith(newPath);
    expect(api.saveBackupPath).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="backup-current"]').text()).toBe(oldPath);
    expect(wrapper.get('[data-testid="backup-message"]').text()).toContain("尚未保存");
    await wrapper.get("input").setValue("\\\\other\\share");
    expect(wrapper.find('[data-testid="backup-probe-result"]').exists()).toBe(false);
    wrapper.unmount();
  });

  test("uses shared theme-aware form styling for the backup address and label", async () => {
    const wrapper = await page();
    const input = wrapper.get('[data-testid="backup-path"]').element;
    expect(input.matches(".form-field input")).toBe(true);
    expect(wrapper.get('label[for="test-data-backup-path"]').element.matches(".form-field label")).toBe(true);
    expect(input.style.backgroundColor).toBe("");
    wrapper.unmount();
  });

  test("omits static explanatory copy while keeping controls and status", async () => {
    const wrapper = await page();
    expect(wrapper.text()).not.toContain("本地保存不变");
    expect(wrapper.text()).not.toContain("检测由 MES 后端账号执行");
    expect(wrapper.text()).not.toContain("备份数量代表");
    expect(wrapper.find("#backup-help").exists()).toBe(false);
    expect(wrapper.get("input").attributes("aria-describedby")).toBe("backup-result");
    expect(wrapper.get('[data-testid="backup-check"]').text()).toBe("检测路径与权限");
    expect(wrapper.text()).toContain("已备份 24");
    wrapper.unmount();
  });

  test("save changes effective path and clears dirty indicator", async () => {
    const wrapper = await page();
    await wrapper.get("input").setValue(newPath);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(api.saveBackupPath).toHaveBeenCalledWith(newPath);
    expect(wrapper.get('[data-testid="backup-current"]').text()).toBe(newPath);
    expect(wrapper.find('[data-testid="backup-dirty"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("下一轮备份生效");
    wrapper.unmount();
  });

  test("failed save keeps old configuration and explains permission failure", async () => {
    const error = new Error("拒绝访问");
    error.probe = { ok: false, detail: "写入权限不足", checks: [{ label: "文件写入", ok: false }] };
    api.saveBackupPath.mockRejectedValue(error);
    const wrapper = await page();
    await wrapper.get("input").setValue(newPath);
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[data-testid="backup-current"]').text()).toBe(oldPath);
    expect(wrapper.get('[data-testid="backup-error"]').text()).toContain("拒绝访问");
    expect(wrapper.get("input").attributes("aria-invalid")).toBe("true");
    expect(wrapper.text()).toContain("失败 · 文件写入");
    wrapper.unmount();
  });

  test("checking disables duplicate requests and handles timeout feedback", async () => {
    let resolve;
    api.checkBackupPath.mockReturnValue(new Promise((done) => { resolve = done; }));
    const wrapper = await page();
    await wrapper.get('[data-testid="backup-check"]').trigger("click");
    expect(wrapper.get('[data-testid="backup-save"]').attributes("disabled")).toBeDefined();
    expect(wrapper.get("input").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("检测中");
    resolve({ ok: false, detail: "检测超时，请检查连接", checks: [] });
    await flushPromises();
    expect(wrapper.text()).toContain("检测超时");
    expect(wrapper.get('[data-testid="backup-check"]').attributes("disabled")).toBeUndefined();
    wrapper.unmount();
  });

  test("browse only edits the draft, cancellation preserves it", async () => {
    const wrapper = await page();
    await wrapper.get('[data-testid="backup-browse"]').trigger("click");
    await flushPromises();
    expect(wrapper.get("input").element.value).toBe(newPath);
    expect(wrapper.get('[data-testid="backup-current"]').text()).toBe(oldPath);
    api.selectBackupDirectory.mockResolvedValue({ backupPath: "", cancelled: true });
    await wrapper.get('[data-testid="backup-browse"]').trigger("click");
    await flushPromises();
    expect(wrapper.get("input").element.value).toBe(newPath);
    expect(api.saveBackupPath).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  test("status refresh does not overwrite unsaved path", async () => {
    const wrapper = await page();
    await wrapper.get("input").setValue(newPath);
    await wrapper.get('[data-testid="backup-refresh"]').trigger("click");
    await flushPromises();
    expect(wrapper.get("input").element.value).toBe(newPath);
    wrapper.unmount();
  });
});
