import { enableAutoUnmount, flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { defineComponent } from "vue";
import ResourceSidebar from "./ResourceSidebar.vue";
import { useResourceInventory } from "@/composables/useResourceInventory";
import { buildStagingSamplesView, buildTrayResourceSummary } from "@/modules/visualization/stagingSamplesModel";

enableAutoUnmount(afterEach);
const mocks = vi.hoisted(() => ({ read: vi.fn(), replenish: vi.fn(), registrations: [] }));
vi.mock("@/lib/resourceInventoryApi", () => ({
  RESOURCE_INVENTORY_KEY: "mes.resource_inventory",
  readResourceInventory: mocks.read, replenishResourceInventory: mocks.replenish,
  createReplenishmentRequestId: () => "12345678-1234-4234-8234-123456789012",
}));
vi.mock("@/composables/useStorageSnapshotRefresh", () => ({ useStorageSnapshotRefresh: (options) => mocks.registrations.push(options) }));
const snapshot = (remaining = 8) => ({ resources: [
  { key: "salt", name: "盐雾", capacity: 100, remaining, used: 92, replenished: remaining - 8 },
  { key: "mold", name: "霉菌", capacity: 100, remaining: 64, used: 36, replenished: 0 },
], records: [] });

beforeEach(() => { mocks.read.mockReset().mockResolvedValue(snapshot()); mocks.replenish.mockReset(); mocks.registrations = []; });
afterEach(() => { vi.useRealTimers(); });

describe("resource inventory intentional behavior", () => {
  test("keeps numeric information and actions without explanatory narration", async () => {
    const data = snapshot(28);
    data.resources[1].deficit = 5;
    mocks.read.mockResolvedValue(data);
    const wrapper = mount(ResourceSidebar, { props: { trayResource: { key: "tray", name: "托盘", capacity: 10, used: 3, remaining: 7 } } });
    await flushPromises();
    expect(wrapper.text()).toContain("占用 3");
    expect(wrapper.text()).toContain("累计消耗 92 · 已补 20");
    expect(wrapper.text()).toContain("待补缺口 5");
    expect(wrapper.text()).toContain("补充记录");
    expect(wrapper.find('.devices-resource-feedback').exists()).toBe(false);
    expect(wrapper.text()).not.toMatch(/共用数据|自动回补|每托盘|不回补|优先抵扣/);
    await wrapper.get('[data-testid="resource-salt"] button').trigger('click');
    expect(wrapper.text()).toContain("当前剩余");
    expect(wrapper.text()).toContain("补充后预计");
    expect(wrapper.text()).toContain("单次补充 1–10,000 份");
    expect(wrapper.text()).not.toMatch(/6 号屏|不覆盖|每托盘|请求编号|重复入账/);
  });

  test("releases trays after all assigned experiments finish; consumables never follow tray count", () => {
    const input = {
      samples: [{ code: "S1", task_code: "T", trays: [{ tray_code: "TRAY" }] }],
      experiments: [{ task_code: "T", experiment_code: "SALT", experiment_name: "盐雾试验" }, { task_code: "T", experiment_code: "MOLD", experiment_name: "霉菌试验" }],
      experimentTrays: [{ task_code: "T", experiment_code: "SALT", tray_code: "TRAY" }, { task_code: "T", experiment_code: "MOLD", tray_code: "TRAY" }],
      experimentRunTrays: [{ task_code: "T", experiment_code: "SALT", tray_code: "TRAY", status: "实验已完成" }],
      resourceInventory: snapshot(),
    };
    expect(buildTrayResourceSummary(input).remaining).toBe(9);
    input.experimentRunTrays.push({ task_code: "T", experiment_code: "MOLD", tray_code: "TRAY", status: "实验已完成" });
    expect(buildTrayResourceSummary(input).remaining).toBe(10);
    const board = buildStagingSamplesView(input);
    expect(board.summary).toMatchObject({ trayRemaining: 10, saltSprayRemaining: 8, moldRemaining: 64 });
    expect(buildStagingSamplesView({ ...input, samples: [] }).summary.saltSprayRemaining).toBe(8);
    expect(buildStagingSamplesView({ ...input, resourceInventory: null }).summary.saltSprayRemaining).toBeNull();
  });

  test("does not free a shared tray on partial-axis completion", () => {
    const input = { samples: [{ task_code: "T", trays: [{ tray_code: "TR" }] }],
      experiments: [{ task_code: "T", experiment_code: "E", experiment_name: "振动试验", axis_codes: ["x", "y", "z"] }],
      experimentTrays: [{ task_code: "T", experiment_code: "E", tray_code: "TR" }],
      experimentRunTrays: [{ task_code: "T", experiment_code: "E", tray_code: "TR", status: "振动试验部分完成 1/3轴" }],
    };
    expect(buildTrayResourceSummary(input).remaining).toBe(9);
  });

  test("sidebar supports replenishing both materials, never trays, with input validation", async () => {
    const wrapper = mount(ResourceSidebar, { props: { trayResource: { key: "tray", name: "托盘", capacity: 10, used: 3, remaining: 7 } }, attachTo: document.body });
    await flushPromises();
    expect(wrapper.get('[data-testid="resource-tray"]').find('button').exists()).toBe(false);
    expect(wrapper.get('[data-testid="resource-salt"]').classes()).toContain("is-low");
    await wrapper.get('[data-testid="resource-salt"] button').trigger("click");
    expect(document.activeElement.id).toBe("resource-quantity");
    await wrapper.get('#resource-quantity').setValue(-1);
    await wrapper.get('form').trigger('submit');
    expect(wrapper.text()).toContain("请输入 1–10,000 之间的正整数");
    expect(mocks.replenish).not.toHaveBeenCalled();
    await wrapper.get('#resource-quantity').setValue(20);
    await wrapper.get('#resource-note').setValue('批次A');
    mocks.replenish.mockResolvedValue(snapshot(28));
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(mocks.replenish).toHaveBeenCalledWith(expect.objectContaining({ resource: 'salt', quantity: 20, note: '批次A' }));
    expect(wrapper.get('[data-testid="resource-salt"]').text()).toContain('28');
    expect(wrapper.get('.devices-resource-feedback').text()).toBe('盐雾已补充 20');
    expect(wrapper.get('[data-testid="resource-salt"]').classes()).not.toContain('is-low');
    await wrapper.get('[data-testid="resource-mold"] button').trigger('click');
    await wrapper.get('#resource-quantity').setValue(5);
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(mocks.replenish.mock.calls.at(-1)[0]).toMatchObject({ resource: 'mold', quantity: 5 });
  });

  test("an uncertain refill freezes its payload and retries with the same request id", async () => {
    const wrapper = mount(ResourceSidebar); await flushPromises();
    await wrapper.get('[data-testid="resource-salt"] button').trigger('click');
    await wrapper.get('#resource-quantity').setValue(10);
    mocks.replenish.mockRejectedValueOnce(new Error('network interrupted')).mockResolvedValue(snapshot(18));
    await wrapper.get('form').trigger('submit'); await flushPromises();
    const first = mocks.replenish.mock.calls[0][0];
    expect(wrapper.get('#resource-quantity').attributes('disabled')).toBeDefined();
    await wrapper.get('.modal-close').trigger('click');
    await wrapper.get('[data-testid="resource-mold"] button').trigger('click');
    expect(wrapper.get('[role="dialog"]').text()).toContain('补充盐雾');
    await wrapper.get('form').trigger('submit'); await flushPromises();
    expect(mocks.replenish.mock.calls[1][0]).toEqual(first);
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  test("late reads cannot overwrite a successful refill, and realtime events refresh both views", async () => {
    let resolveOld;
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    let state;
    const wrapper = mount(defineComponent({ setup() { state = useResourceInventory(); return {}; }, render() { return null; } }));
    state.acceptInventory(snapshot(28)); resolveOld(snapshot(8)); await flushPromises();
    expect(state.inventory.value.resources[0].remaining).toBe(28);
    expect(mocks.registrations[0].keys).toContain('mes.resource_inventory');
    mocks.read.mockResolvedValue(snapshot(38)); await mocks.registrations[0].refresh();
    expect(state.inventory.value.resources[0].remaining).toBe(38);
    mocks.read.mockRejectedValue(new Error('offline')); await state.refresh();
    expect(state.inventory.value.resources[0].remaining).toBe(38);
    expect(state.error.value).toBe('offline'); wrapper.unmount();
  });

  test("system reset refreshes both inventory consumers and clears replenishment history", async () => {
    const before = snapshot(4100);
    before.records = [{ id: 'old-refill', resource: 'salt', quantity: 4000 }];
    mocks.read.mockResolvedValue(before);
    const consumers = [];
    const Harness = defineComponent({ setup() { consumers.push(useResourceInventory()); return {}; }, render() { return null; } });
    mount(Harness); mount(Harness);
    await flushPromises();
    expect(consumers.map(state => state.inventory.value.resources[0].remaining)).toEqual([4100, 4100]);
    const reset = { resources: ["salt", "mold"].map(key => ({ key, remaining: 100, used: 0, replenished: 0, deficit: 0 })), records: [] };
    mocks.read.mockResolvedValue(reset);
    const registrations = mocks.registrations.filter(item => item.keys.includes('mes.resource_inventory'));
    expect(registrations).toHaveLength(2);
    await Promise.all(registrations.map(item => item.refresh(['mes.resource_inventory'])));
    consumers.forEach(state => expect(state.inventory.value).toEqual(reset));
  });
});
