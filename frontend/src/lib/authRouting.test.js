import { describe, expect, test } from "vitest";

import { buildRouteAccessDecision } from "./authRouting";

describe("authRouting", () => {
  test("redirects authenticated users away from the login page", async () => {
    await expect(
      buildRouteAccessDecision({
        session: { logged_at: "2026-03-11T00:00:00Z", module: "visual", username: "admin" },
        to: {
          meta: { layout: "auth" },
        },
      })
    ).resolves.toBe("/visualization");
  });

  test("redirects unauthenticated users to login with the original path", async () => {
    await expect(
      buildRouteAccessDecision({
        session: null,
        to: {
          fullPath: "/process?tab=live",
          meta: { module: "central" },
        },
      })
    ).resolves.toEqual({
      path: "/login",
      query: { redirect: "/process?tab=live" },
    });
  });

  test("redirects authenticated users away from modules outside their assigned area", async () => {
    await expect(
      buildRouteAccessDecision({
        session: { logged_at: "2026-03-11T00:00:00Z", module: "staging", username: "admin" },
        to: {
          meta: { module: "central" },
        },
      })
    ).resolves.toBe("/staging-management");
  });

  test("allows access when the selected module matches the target route", async () => {
    await expect(
      buildRouteAccessDecision({
        session: { logged_at: "2026-03-11T00:00:00Z", module: "central", username: "admin" },
        to: {
          meta: { module: "central" },
        },
      })
    ).resolves.toBe(true);
  });

  test("allows access when the staging module matches the target route", async () => {
    await expect(
      buildRouteAccessDecision({
        session: { logged_at: "2026-03-11T00:00:00Z", module: "staging", username: "admin" },
        to: {
          meta: { module: "staging" },
        },
      })
    ).resolves.toBe(true);
  });

  test("redirects authenticated laboratory users away from the login page to /laboratory", async () => {
    await expect(
      buildRouteAccessDecision({
        session: { logged_at: "2026-03-11T00:00:00Z", module: "laboratory", username: "admin" },
        to: {
          meta: { layout: "auth" },
        },
      }),
    ).resolves.toBe("/laboratory");
  });

  test("keeps a fixed laboratory terminal bound to its configured room", async () => {
    const session = {
      lab_name: "冲击二室",
      logged_at: "2026-03-11T00:00:00Z",
      module: "laboratory",
      terminal_auth: true,
      username: "terminal:IMPACT-PC-02",
    };

    await expect(
      buildRouteAccessDecision({
        session,
        to: { meta: { layout: "auth" } },
      }),
    ).resolves.toEqual({ path: "/laboratory", query: { lab: "冲击二室" } });

    await expect(
      buildRouteAccessDecision({
        session,
        to: { meta: { module: "laboratory" }, query: { lab: "冲击一室" } },
      }),
    ).resolves.toEqual({ path: "/laboratory", query: { lab: "冲击二室" } });
  });

  test("hydrates session through the provided getter when session is omitted", async () => {
    await expect(
      buildRouteAccessDecision({
        getSession: async () => ({ logged_at: "2026-03-11T00:00:00Z", module: "visual", username: "admin" }),
        to: {
          meta: { module: "visual" },
        },
      })
    ).resolves.toBe(true);
  });
});
