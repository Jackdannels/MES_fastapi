import { computed, ref } from "vue";

const THEME_STORAGE_KEY = "mes.theme";
const DARK_THEME = "dark";
const LIGHT_THEME = "light";

const normalizeTheme = (value) => (value === LIGHT_THEME ? LIGHT_THEME : DARK_THEME);

const readSavedTheme = () => {
  if (typeof window === "undefined") {
    return DARK_THEME;
  }

  try {
    return normalizeTheme(window.localStorage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return DARK_THEME;
  }
};

const applyTheme = (nextTheme) => {
  const theme = normalizeTheme(nextTheme);
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
  return theme;
};

const persistTheme = (nextTheme) => {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage?.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {
    // Storage can be blocked without preventing a session-level theme change.
  }
};

const theme = ref(readSavedTheme());

const initializeTheme = () => {
  theme.value = applyTheme(readSavedTheme());
  return theme.value;
};

const useTheme = () => {
  const setTheme = (nextTheme) => {
    theme.value = applyTheme(nextTheme);
    persistTheme(theme.value);
  };

  const toggleTheme = () => setTheme(theme.value === LIGHT_THEME ? DARK_THEME : LIGHT_THEME);

  return {
    theme,
    isLightTheme: computed(() => theme.value === LIGHT_THEME),
    setTheme,
    toggleTheme,
  };
};

export { DARK_THEME, LIGHT_THEME, THEME_STORAGE_KEY, initializeTheme, useTheme };
