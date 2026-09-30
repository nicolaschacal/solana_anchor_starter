export type Theme = "light" | "dark";
const STORAGE_KEY = "rebyters:theme";

export function initializeTheme() {
  let theme: Theme = window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "dark" || saved === "light") theme = saved;
  } catch {
    /* The theme still works when browser storage is unavailable. */
  }
  document.documentElement.dataset.theme = theme;
}

export function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    /* Keep the in-memory preference. */
  }
}
