import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ loadSnapshot: vi.fn(), readMasterLabs: vi.fn(), writePatch: vi.fn() }));
vi.mock("@/composables/useStorageSnapshot", () => ({ useStorageSnapshot: () => ({ loadSnapshot: mocks.loadSnapshot }) }));
vi.mock("@/lib/masterDataApi", () => ({ readMasterLabs: mocks.readMasterLabs }));
vi.mock("@/lib/storageApi", () => ({
  SNAPSHOT_UPDATED_EVENT: "mes:snapshot-updated", SNAPSHOT_UPDATED_STORAGE_KEY: "mes:snapshot-updated-at",
  subscribeStorageSnapshotUpdates: () => () => {}, writeStorageSchedulePatch: mocks.writePatch,
}));

import SchedulePage from "./page.vue";

const source = { id: "move", task_code: "TASK-1", experiment_code: "TASK-1-A", device: "冲击一室", status: "已排程", planned_hours: 1, start_at: "2099-03-20T14:00:00", end_at: "2099-03-20T15:00:00", axis_codes: ["x+"], axis_batch_no: "BATCH-1", sub_experiment_code: "TASK-1-A-X" };
let snapshot;
let wrapper;
const settle = async () => { for (let i = 0; i < 20; i += 1) { await Promise.resolve(); await wrapper.vm.$nextTick(); } };
const drag = async (device = "冲击一室", date = "2099-03-21", slot = "am") => {
  const dataTransfer = { setData: vi.fn() };
  const button = wrapper.get('[data-testid="gantt-segment-move"] button');
  expect(button.element.draggable).toBe(true);
  await button.trigger("dragstart", { dataTransfer });
  const target = wrapper.get(`[data-testid="gantt-drop-${device}-${date}-${slot}"]`);
  await target.trigger("dragover", { dataTransfer });
  expect(target.classes()).toContain("is-hovered");
  await target.trigger("drop", { dataTransfer });
  await settle();
};
const addBlocker = () => {
  snapshot["mes.schedules"].push({ id: "blocker", task_code: "TASK-2", experiment_code: "TASK-2-A", device: "冲击一室", status: "已排程", planned_hours: 2, start_at: "2099-03-21T08:00:00", end_at: "2099-03-21T10:00:00" });
};

describe("SchedulePage drag rescheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-03-19T01:00:00Z"));
    snapshot = {
      "mes.conflicts": [], "mes.devices": [{ code: "冲击一室" }],
      "mes.experiments": [{ task_code: "TASK-1", experiment_code: "TASK-1-A", required_device: "冲击一室", experiment_name: "冲击试验" }],
      "mes.experiment_runs": [], "mes.experiment_run_steps": [], "mes.experiment_run_trays": [], "mes.experiment_trays": [], "mes.samples": [],
      "mes.schedules": [{ ...source }], "mes.streams": [],
      "mes.tasks": [{ code: "TASK-1", status: "已排程", test_type: "冲击试验" }, { code: "TASK-2", status: "已排程", test_type: "冲击试验" }],
    };
    mocks.loadSnapshot.mockImplementation(async () => structuredClone(snapshot));
    mocks.readMasterLabs.mockResolvedValue([]);
    mocks.writePatch.mockImplementation(async patch => {
      for (const [key, rows] of Object.entries(patch.upserts || {})) {
        const remaining = snapshot[key].filter(row => !rows.some(next => (next.id && next.id === row.id) || (key === "mes.tasks" && next.code === row.code)));
        snapshot[key] = [...remaining, ...JSON.parse(JSON.stringify(rows))];
      }
      return { ok: true };
    });
  });
  afterEach(() => {
    wrapper?.unmount();
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  test("previews an afternoon experiment at 08:00 next day and saves its original id and duration on confirmation", async () => {
    wrapper = mount(SchedulePage);
    await settle();
    await drag();
    expect(wrapper.get('[data-testid="schedule-drag-new-start"]').text()).toBe("2099-03-21 08:00");
    expect(wrapper.get('[data-testid="schedule-drag-new-end"]').text()).toBe("2099-03-21 09:00");
    expect(mocks.writePatch).not.toHaveBeenCalled();
    await wrapper.get('[data-testid="schedule-drag-confirm"]').trigger("click");
    await settle();
    expect(mocks.writePatch).toHaveBeenCalledOnce();
    const moved = mocks.writePatch.mock.calls[0][0].upserts["mes.schedules"][0];
    expect(moved).toMatchObject({ ...source, start_at: "2099-03-21 08:00:00", end_at: "2099-03-21 09:00:00" });
    expect(wrapper.find('[data-testid="schedule-drag-modal"].is-open').exists()).toBe(false);
    expect(wrapper.text()).toContain("排程已移动并保存");
  });

  test("appends ten minutes after the previous experiment", async () => {
    addBlocker();
    wrapper = mount(SchedulePage);
    await settle();
    await drag();
    expect(wrapper.get('[data-testid="schedule-drag-new-start"]').text()).toBe("2099-03-21 10:10");
    expect(wrapper.get('[data-testid="schedule-drag-new-end"]').text()).toBe("2099-03-21 11:10");
  });

  test("drags an individual experiment from a split cell and resolves the target inside a merged empty cell", async () => {
    snapshot["mes.schedules"].push({ id: "same-day", task_code: "TASK-2", experiment_code: "TASK-2-A", device: "冲击一室", status: "已排程", planned_hours: 1, start_at: "2099-03-20T16:00:00", end_at: "2099-03-20T17:00:00" });
    wrapper = mount(SchedulePage);
    await settle();
    const sourceButton = wrapper.get('[data-testid="gantt-task-item-move"]');
    expect(sourceButton.element.draggable).toBe(true);
    await sourceButton.trigger("dragstart", { dataTransfer: { setData: vi.fn() } });
    const morning = wrapper.get('[data-testid="gantt-drop-冲击一室-2099-03-21-am"]');
    const afternoon = wrapper.get('[data-testid="gantt-drop-冲击一室-2099-03-21-pm"]');
    expect(morning.element.parentElement).toBe(afternoon.element.parentElement);
    await morning.trigger("drop");
    await settle();
    expect(wrapper.get('[data-testid="schedule-drag-new-start"]').text()).toBe("2099-03-21 08:00");
    expect(mocks.writePatch).not.toHaveBeenCalled();
  });

  test("cancels without writing or moving the original schedule", async () => {
    wrapper = mount(SchedulePage);
    await settle();
    await drag();
    await wrapper.get('[data-testid="schedule-drag-cancel"]').trigger("click");
    expect(mocks.writePatch).not.toHaveBeenCalled();
    expect(snapshot["mes.schedules"][0]).toEqual(source);
    expect(wrapper.find('[data-testid="schedule-drag-modal"].is-open').exists()).toBe(false);
  });

  test("requires another confirmation when another user occupies the destination after preview", async () => {
    wrapper = mount(SchedulePage);
    await settle();
    await drag();
    addBlocker();
    await wrapper.get('[data-testid="schedule-drag-confirm"]').trigger("click");
    await settle();
    expect(mocks.writePatch).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="schedule-drag-new-start"]').text()).toBe("2099-03-21 10:10");
    expect(wrapper.text()).toContain("排程数据已变化");
    await wrapper.get('[data-testid="schedule-drag-confirm"]').trigger("click");
    await settle();
    expect(mocks.writePatch).toHaveBeenCalledOnce();
  });

  test("blocks saving if the experiment has completed comparison since preview", async () => {
    wrapper = mount(SchedulePage);
    await settle();
    await drag();
    snapshot["mes.experiment_runs"].push({ schedule_id: "move", task_code: "TASK-1", experiment_code: "TASK-1-A", status: "已到达实验室" });
    await wrapper.get('[data-testid="schedule-drag-confirm"]').trigger("click");
    await settle();
    expect(mocks.writePatch).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("不能拖拽改期");
  });

  test("does not allow dragging a compared experiment", async () => {
    snapshot["mes.experiment_runs"].push({ schedule_id: "move", task_code: "TASK-1", experiment_code: "TASK-1-A", status: "工装夹具安装" });
    wrapper = mount(SchedulePage);
    await settle();
    expect(wrapper.get('[data-testid="gantt-segment-move"] button').element.draggable).toBe(false);
  });

  test("blocks saving if the task has been returned to the manufacturer since preview", async () => {
    wrapper = mount(SchedulePage);
    await settle();
    await drag();
    snapshot["mes.tasks"][0].status = "厂家收回";
    await wrapper.get('[data-testid="schedule-drag-confirm"]').trigger("click");
    await settle();
    expect(mocks.writePatch).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain("不能拖拽改期");
  });

  test("keeps the preview open and the schedule in place on a server rejection", async () => {
    wrapper = mount(SchedulePage);
    await settle();
    await drag();
    mocks.writePatch.mockRejectedValueOnce(new Error("排程冲突，请刷新"));
    await wrapper.get('[data-testid="schedule-drag-confirm"]').trigger("click");
    await settle();
    expect(wrapper.find('[data-testid="schedule-drag-modal"].is-open').exists()).toBe(true);
    expect(wrapper.text()).toContain("移动未保存");
    expect(snapshot["mes.schedules"][0]).toEqual(source);
  });

  test("does not preview or save using stale data when the fresh snapshot cannot be read", async () => {
    wrapper = mount(SchedulePage);
    await settle();
    mocks.loadSnapshot.mockRejectedValueOnce(new Error("网络中断"));
    await drag();
    expect(wrapper.find('[data-testid="schedule-drag-modal"].is-open').exists()).toBe(false);
    expect(wrapper.text()).toContain("无法读取最新排程");
    expect(mocks.writePatch).not.toHaveBeenCalled();
  });

  test("rejects a drop into a different laboratory", async () => {
    wrapper = mount(SchedulePage);
    await settle();
    await drag("冲击二室");
    expect(wrapper.text()).toContain("同一实验室");
    expect(mocks.writePatch).not.toHaveBeenCalled();
  });

  test("prevents duplicate submissions while saving", async () => {
    wrapper = mount(SchedulePage);
    await settle();
    await drag();
    let finish;
    mocks.writePatch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await wrapper.get('[data-testid="schedule-drag-confirm"]').trigger("click");
    await settle();
    const confirm = wrapper.get('[data-testid="schedule-drag-confirm"]');
    expect(confirm.element.disabled).toBe(true);
    await confirm.trigger("click");
    expect(mocks.writePatch).toHaveBeenCalledOnce();
    finish({ ok: true });
    await settle();
    expect(wrapper.find('[data-testid="schedule-drag-modal"].is-open').exists()).toBe(false);
  });
});
