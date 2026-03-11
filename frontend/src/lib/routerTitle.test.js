import { describe, expect, test } from "vitest";

import { buildDocumentTitle } from "./routerTitle";

describe("routerTitle", () => {
  test("builds a branded title when the route provides a page title", () => {
    expect(buildDocumentTitle("任务总览")).toBe("任务总览 - 七二四新火工区信息化中控管理系统");
  });

  test("falls back to the application title when the route title is empty", () => {
    expect(buildDocumentTitle("")).toBe("七二四新火工区信息化中控管理系统");
    expect(buildDocumentTitle()).toBe("七二四新火工区信息化中控管理系统");
  });
});
