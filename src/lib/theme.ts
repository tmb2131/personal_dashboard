export type Theme = "dark" | "light";

const STORAGE_KEY = "dashboard-theme";
export const THEME_CHANGE_EVENT = "dashboard-theme-changed";

export function applyTheme(theme: Theme): void {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  html.classList.toggle("theme-dark", theme === "dark");
  html.classList.toggle("theme-light", theme === "light");
  try {
    window.localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // ignore storage failures (private mode, full disk, etc.)
  }
}

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const html = document.documentElement;
  if (html.classList.contains("theme-dark")) return "dark";
  if (html.classList.contains("theme-light")) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme: next } }));
  }
  return next;
}

export function loadStoredTheme(): void {
  if (typeof window === "undefined") return;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "dark" || stored === "light") {
      applyTheme(stored);
    }
  } catch {
    // ignore
  }
}
