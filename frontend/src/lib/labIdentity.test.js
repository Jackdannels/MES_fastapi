import { describe, expect, test } from "vitest";

import { labIdentityMatches, scheduleMatchesLab, scheduleTargetsStorageArea } from "./labIdentity";

describe("labIdentity", () => {
  test("matches schedules by lab id before display names", () => {
    expect(scheduleMatchesLab(
      { device: "旧名称", lab_code: "LAB_OLD", lab_id: 9 },
      { name: "盐雾试验室", labCode: "LAB_SALT", labId: 9 },
    )).toBe(true);

    expect(scheduleMatchesLab(
      { device: "盐雾试验室", lab_code: "LAB_SALT", lab_id: 9 },
      { name: "盐雾试验室", labCode: "LAB_SALT", labId: 10 },
    )).toBe(false);
  });

  test("matches lab references by code before display names", () => {
    expect(labIdentityMatches(
      { device: "旧显示名", lab_code: "LAB_IMPACT_1" },
      { name: "冲击一室", code: "LAB_IMPACT_1" },
    )).toBe(true);

    expect(labIdentityMatches(
      { device: "冲击一室", lab_code: "LAB_IMPACT_2" },
      { name: "冲击一室", code: "LAB_IMPACT_1" },
    )).toBe(false);
  });

  test("falls back to display names only when precise identity keys are missing", () => {
    expect(scheduleMatchesLab(
      { device: "温度冲击一室" },
      { name: "温度冲击一室" },
    )).toBe(true);
  });

  test("falls back to display names when a legacy device code is a room name", () => {
    expect(scheduleMatchesLab(
      { device: "冲击一室", lab_code: "LAB_IMPACT_1" },
      { code: "冲击一室", name: "冲击试验系统-1" },
    )).toBe(true);
  });

  test("does not treat sample codes as lab codes", () => {
    expect(labIdentityMatches(
      { code: "LAB_IMPACT_1", location: "冲击二室" },
      { code: "LAB_IMPACT_1", name: "冲击一室" },
    )).toBe(false);
  });

  test("classifies storage schedules by area code before display text", () => {
    expect(scheduleTargetsStorageArea({ device: "冲击一室", lab_code: "AREA_STAGING_PRE" })).toBe(true);
    expect(scheduleTargetsStorageArea({ device: "冲击一室", lab_code: "AREA_STAGING_POST" })).toBe(true);
    expect(scheduleTargetsStorageArea({ device: "恒温恒湿间（暂存间）", lab_code: "LAB_SALT" })).toBe(false);
    expect(scheduleTargetsStorageArea({ device: "恒温恒湿间（暂存间）" })).toBe(true);
  });
});
