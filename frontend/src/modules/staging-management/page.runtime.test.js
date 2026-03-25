import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vitest";

import StagingManagementPage from "./page.vue";

let wrapper;
let headerActions;

const mountPage = async () => {
  headerActions = document.createElement("div");
  headerActions.className = "header-actions";
  headerActions.innerHTML = `
    <button class="action-btn secondary" type="button">刷新</button>
    <button class="action-btn secondary" type="button">退出登录</button>
  `;
  document.body.appendChild(headerActions);

  wrapper = mount(StagingManagementPage, {
    attachTo: document.body,
  });
  await Promise.resolve();
  return wrapper;
};

describe("StagingManagementPage runtime", () => {
  afterEach(() => {
    wrapper?.unmount();
    wrapper = undefined;
    headerActions?.remove();
    headerActions = undefined;
  });

  test("opens overview modal from the header action button and filters sample rows", async () => {
    const mounted = await mountPage();

    expect(mounted.text()).not.toContain("样品信息总览清单");

    const openButton = document.body.querySelector('[data-testid="zancun-open-overview"]');
    expect(openButton).not.toBeNull();

    openButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    expect(mounted.find('[data-testid="zancun-overview-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="zancun-overview-row-tray-0"]').text()).toBe("WDC-2026-008-TP-001");

    await mounted.get('[data-testid="zancun-overview-search"]').setValue("GDW-2026-002-TP-001");

    expect(mounted.text()).toContain("GDW-2026-002-TP-001");
    expect(mounted.text()).not.toContain("WDC-2026-008-TP-001");
  });

  test("paginates and sorts overview rows inside the overview modal", async () => {
    const mounted = await mountPage();

    document.body.querySelector('[data-testid="zancun-open-overview"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();

    await mounted.get('[data-testid="zancun-overview-pagination"]').find('[data-page="2"]').trigger("click");

    expect(mounted.text()).toContain("SZH-2026-005-TP-001");
    expect(mounted.text()).toContain("ICP-2026-001-TP-001");

    await mounted.get('[data-testid="zancun-overview-sort-quantity"]').trigger("click");
    await mounted.get('[data-testid="zancun-overview-sort-quantity"]').trigger("click");

    expect(mounted.get('[data-testid="zancun-overview-row-tray-0"]').text()).toBe("WDC-2026-008-TP-001");
  });

  test("opens stock-in scan modal with only the centered complete action and can close from the modal header", async () => {
    const mounted = await mountPage();

    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(true);
    expect(mounted.text()).toContain("扫码入库");
    expect(mounted.find('[data-testid="zancun-scan-cancel"]').exists()).toBe(false);

    await mounted.get('[data-testid="zancun-scan-modal"] .modal-close').trigger("click");

    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);
  });

  test("scanning for stock in opens detail modal and confirm closes the flow", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-in"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("ZD-2026-003-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);
    expect(mounted.find('[data-testid="zancun-detail-modal"].is-open').exists()).toBe(true);
    expect(mounted.get('[data-testid="zancun-detail-tray"]').element.value).toBe("ZD-2026-003-TP-001");
    expect(mounted.text()).toContain("确认入库");

    await mounted.get('[data-testid="zancun-detail-confirm"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-detail-modal"].is-open').exists()).toBe(false);
    expect(mounted.text()).toContain("今日待入库1");
  });

  test("stock out scan can close from the modal header and complete into a detail confirmation modal", async () => {
    const mounted = await mountPage();

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    expect(mounted.text()).toContain("扫码出库");
    expect(mounted.find('[data-testid="zancun-scan-cancel"]').exists()).toBe(false);

    await mounted.get('[data-testid="zancun-scan-modal"] .modal-close').trigger("click");
    expect(mounted.find('[data-testid="zancun-scan-modal"].is-open').exists()).toBe(false);

    await mounted.get('[data-testid="zancun-stock-out"]').trigger("click");
    await mounted.get('[data-testid="zancun-scan-code"]').setValue("WDC-2026-008-TP-001");
    await mounted.get('[data-testid="zancun-scan-complete"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-detail-modal"].is-open').exists()).toBe(true);
    expect(mounted.text()).toContain("确认出库");

    await mounted.get('[data-testid="zancun-detail-confirm"]').trigger("click");

    expect(mounted.find('[data-testid="zancun-detail-modal"].is-open').exists()).toBe(false);
    expect(mounted.text()).toContain("暂存间中样品数量18");
    expect(mounted.text()).toContain("今日待出库2");
  });
});
