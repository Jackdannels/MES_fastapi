import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLabels: vi.fn(() => ({ sourceExternal: "外部", sourceInternal: "内部" })),
  renderAll: vi.fn(),
  attachActionHandlers: vi.fn(),
  attachDrawerHandlers: vi.fn(),
  attachFilterHandlers: vi.fn(),
  attachModalHandlers: vi.fn(),
  attachSortHandlers: vi.fn(),
  attachTabHandlers: vi.fn(),
  initLabSelects: vi.fn(),
  initTestLabSelects: vi.fn(),
  initDispatchTargetSelects: vi.fn(),
  initTestTypeSelects: vi.fn(),
  initRemoteStore: vi.fn(() => Promise.resolve()),
  seedData: vi.fn(),
}));

vi.mock("./runtime/labels.js", () => ({
  getLabels: mocks.getLabels,
}));

vi.mock("./runtime/render.js", () => ({
  renderAll: mocks.renderAll,
}));

vi.mock("./runtime/actions.js", () => ({
  attachActionHandlers: mocks.attachActionHandlers,
}));

vi.mock("./runtime/ui.js", () => ({
  attachDrawerHandlers: mocks.attachDrawerHandlers,
  attachFilterHandlers: mocks.attachFilterHandlers,
  attachModalHandlers: mocks.attachModalHandlers,
  attachSortHandlers: mocks.attachSortHandlers,
  attachTabHandlers: mocks.attachTabHandlers,
}));

vi.mock("./runtime/labs.js", () => ({
  initLabSelects: mocks.initLabSelects,
  initTestLabSelects: mocks.initTestLabSelects,
  initDispatchTargetSelects: mocks.initDispatchTargetSelects,
  initTestTypeSelects: mocks.initTestTypeSelects,
}));

vi.mock("./runtime/storage.js", () => ({
  initRemoteStore: mocks.initRemoteStore,
}));

vi.mock("./runtime/seed.js", () => ({
  seedData: mocks.seedData,
}));

describe("legacy boot runtime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.__MES_VUE_BOOT__ = true;
  });

  afterEach(() => {
    delete window.__MES_VUE_BOOT__;
  });

  test("seeds shared storage before rendering legacy pages", async () => {
    const { bootLegacyUI } = await import("./runtime/main.js");

    await bootLegacyUI();

    expect(mocks.initRemoteStore).toHaveBeenCalledTimes(1);
    expect(mocks.seedData).toHaveBeenCalledTimes(1);
    expect(mocks.seedData).toHaveBeenCalledWith(mocks.getLabels.mock.results[0].value);
    expect(mocks.renderAll).toHaveBeenCalledTimes(1);
  });
});
