import { useState, useEffect, useCallback } from "react";

export type Theme = "dark" | "light" | "system";

const STORAGE_KEY = "rssh_theme";
const CHANGE_EVENT = "rssh:theme-change";

function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "dark" || v === "light") return v;
  } catch { /* ignore */ }
  return "system";
}

function applyDomTheme(t: Theme) {
  if (t === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else if (t === "light") {
    document.documentElement.setAttribute("data-theme", "light");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
}

export function resolveTheme(t: Theme): "dark" | "light" {
  if (t === "dark" || t === "light") return t;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function getCurrentResolvedTheme(): "dark" | "light" {
  return resolveTheme(readStoredTheme());
}

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readStoredTheme);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch { /* ignore */ }
    applyDomTheme(t);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: resolveTheme(t) }));
  }, []);

  // Listen for OS color scheme changes (only matters in "system" mode)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (readStoredTheme() === "system") {
        // Force React re-render so consumers see updated resolved value
        setThemeState("system");
        window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: resolveTheme("system") }));
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  return { theme, setTheme, resolved: resolveTheme(theme) } as const;
}
