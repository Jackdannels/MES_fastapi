import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { DARK_THEME, LIGHT_THEME, THEME_STORAGE_KEY, initializeTheme, useTheme } from "./useTheme";

describe("useTheme", () => {
  let localStorageDescriptor;

  beforeEach(() => {
    const values = new Map();
    localStorageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => values.get(key) || null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: (key) => values.delete(key),
      },
    });
    document.documentElement.removeAttribute("data-theme");
    initializeTheme();
  });

  afterEach(() => {
    if (localStorageDescriptor) {
      Object.defineProperty(window, "localStorage", localStorageDescriptor);
    }
  });

  test("defaults to the existing dark theme when no preference is saved", () => {
    expect(document.documentElement.dataset.theme).toBe(DARK_THEME);
  });

  test("applies and persists a white theme selection", () => {
    const { isLightTheme, setTheme } = useTheme();

    setTheme(LIGHT_THEME);

    expect(isLightTheme.value).toBe(true);
    expect(document.documentElement.dataset.theme).toBe(LIGHT_THEME);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe(LIGHT_THEME);
  });

  test("restores the saved selection on application initialization", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, LIGHT_THEME);

    initializeTheme();

    expect(document.documentElement.dataset.theme).toBe(LIGHT_THEME);
  });
});
