import { beforeEach, describe, expect, test, vi } from "vitest";

import { AUTH_STORAGE_KEY, fetchAuthSession, loginWithCredentials, logoutSession, readAuthSession } from "./auth";

describe("auth", () => {
  beforeEach(() => {
    const store = new Map();
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem(key) {
          return store.has(key) ? store.get(key) : null;
        },
        setItem(key, value) {
          store.set(key, String(value));
        },
        removeItem(key) {
          store.delete(key);
        },
        clear() {
          store.clear();
        },
      },
    });
    vi.restoreAllMocks();
  });

  test("loginWithCredentials stores the backend session on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ username: "admin", module: "visual", logged_at: "2026-03-10T00:00:00Z" }),
    });
    vi.stubGlobal(
      "fetch",
      fetchMock
    );

    const result = await loginWithCredentials("admin", "123", "visual");

    expect(result).toEqual({ ok: true, module: "visual" });
    expect(fetchMock).toHaveBeenCalledWith("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        username: "admin",
        password: "123",
        module: "visual",
      }),
    });
    expect(readAuthSession()).toEqual({
      logged_at: "2026-03-10T00:00:00Z",
      module: "visual",
      username: "admin",
    });
  });

  test("loginWithCredentials returns backend error messages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Invalid credentials" }),
      })
    );

    const result = await loginWithCredentials("bad", "bad", "central");

    expect(result).toEqual({ ok: false, message: "Invalid credentials" });
  });

  test("fetchAuthSession hydrates the backend session into local cache", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ username: "admin", module: "visual", logged_at: "2026-03-11T00:00:00Z" }),
      })
    );

    const session = await fetchAuthSession();

    expect(session).toEqual({
      logged_at: "2026-03-11T00:00:00Z",
      module: "visual",
      username: "admin",
    });
    expect(fetch).toHaveBeenCalledWith("/auth/session", {
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
    });
    expect(readAuthSession()).toEqual(session);
  });

  test("fetchAuthSession clears cached state when the backend rejects the session", async () => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        logged_at: "2026-03-11T00:00:00Z",
        module: "visual",
        username: "admin",
      })
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ detail: "Not authenticated" }),
      })
    );

    const session = await fetchAuthSession();

    expect(session).toBeNull();
    expect(readAuthSession()).toBeNull();
  });

  test("readAuthSession rejects malformed sessions", () => {
    window.localStorage.setItem(
      "mes_auth_session_v1",
      JSON.stringify({
        module: "unknown",
        username: "admin",
      })
    );

    expect(readAuthSession()).toBeNull();
  });

  test("logoutSession clears cached state even if the backend call succeeds", async () => {
    window.localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        logged_at: "2026-03-11T00:00:00Z",
        module: "visual",
        username: "admin",
      })
    );
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    vi.stubGlobal("fetch", fetchMock);

    await logoutSession();

    expect(fetchMock).toHaveBeenCalledWith("/auth/logout", {
      headers: {
        Accept: "application/json",
      },
      credentials: "include",
      method: "POST",
    });
    expect(readAuthSession()).toBeNull();
  });
});
