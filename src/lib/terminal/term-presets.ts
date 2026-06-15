/**
 * Terminal color theme presets.
 *
 * Each preset defines a full xterm.js ITheme-compatible object (16 ANSI colors
 * + background/foreground/cursor/selection). Presets are persisted by ID to
 * localStorage and applied live via terminal.options.theme.
 */
import type { ITheme } from "@xterm/xterm";

export interface TermPreset {
  id: string;
  name: string;
  theme: ITheme;
}

export const TERM_PRESET_KEY = "rssh_termPreset";

const presets: TermPreset[] = [
  {
    id: "vscode-dark",
    name: "VS Code Dark",
    theme: {
      background: "#181818",
      foreground: "#cccccc",
      cursor: "#ffffff",
      selectionBackground: "#264f78",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#e5e5e5",
    },
  },
  {
    id: "dracula",
    name: "Dracula",
    theme: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
  },
  {
    id: "solarized-dark",
    name: "Solarized Dark",
    theme: {
      background: "#002b36",
      foreground: "#839496",
      cursor: "#93a1a1",
      selectionBackground: "#073642",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#eee8d5",
      brightBlack: "#586e75",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#fdf6e3",
    },
  },
  {
    id: "nord",
    name: "Nord",
    theme: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      selectionBackground: "#434c5e",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    theme: {
      background: "#1a1b26",
      foreground: "#a9b1d6",
      cursor: "#c0caf5",
      selectionBackground: "#283457",
      black: "#32344a",
      red: "#f7768e",
      green: "#9ece6a",
      yellow: "#e0af68",
      blue: "#7aa2f7",
      magenta: "#ad8ee6",
      cyan: "#449dab",
      white: "#a9b1d6",
      brightBlack: "#444b6a",
      brightRed: "#ff7a93",
      brightGreen: "#b9f27c",
      brightYellow: "#ff9e64",
      brightBlue: "#7da6ff",
      brightMagenta: "#bb9af7",
      brightCyan: "#0db9d7",
      brightWhite: "#acb0d0",
    },
  },
  {
    id: "monokai",
    name: "Monokai",
    theme: {
      background: "#272822",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      selectionBackground: "#49483e",
      black: "#272822",
      red: "#f92672",
      green: "#a6e22e",
      yellow: "#f4bf75",
      blue: "#66d9ef",
      magenta: "#ae81ff",
      cyan: "#a1efe4",
      white: "#f8f8f2",
      brightBlack: "#75715e",
      brightRed: "#f92672",
      brightGreen: "#a6e22e",
      brightYellow: "#f4bf75",
      brightBlue: "#66d9ef",
      brightMagenta: "#ae81ff",
      brightCyan: "#a1efe4",
      brightWhite: "#f9f8f5",
    },
  },
  {
    id: "vscode-light",
    name: "VS Code Light",
    theme: {
      background: "#FFFFFF",
      foreground: "#333333",
      cursor: "#333333",
      selectionBackground: "#ADD6FF",
      black: "#000000",
      red: "#CD3131",
      green: "#0DBC79",
      yellow: "#E5E510",
      blue: "#2472C8",
      magenta: "#BC3FBC",
      cyan: "#11A8CD",
      white: "#E5E5E5",
      brightBlack: "#666666",
      brightRed: "#F14C4C",
      brightGreen: "#23D18B",
      brightYellow: "#F5F543",
      brightBlue: "#3B8EEA",
      brightMagenta: "#D670D6",
      brightCyan: "#29B8DB",
      brightWhite: "#E5E5E5",
    },
  },
];

/** Get all available presets. */
export function listTermPresets(): TermPreset[] {
  return presets;
}

/** Get a preset by ID. Falls back to VS Code Dark if not found. */
export function getTermPreset(id: string): TermPreset {
  return presets.find((p) => p.id === id) ?? presets[0];
}

/** Read the current preset ID from localStorage. */
export function loadTermPresetId(): string {
  try {
    return localStorage.getItem(TERM_PRESET_KEY) || presets[0].id;
  } catch {
    return presets[0].id;
  }
}

/** Resolve the current theme (reads localStorage → returns ITheme). */
export function resolveTermTheme(): ITheme {
  return getTermPreset(loadTermPresetId()).theme;
}

/** Persist a preset ID and notify all listeners. */
export function setTermPreset(id: string): void {
  try {
    localStorage.setItem(TERM_PRESET_KEY, id);
  } catch { /* ignore */ }
  // Also save as the choice for the current resolved UI theme
  // Dynamic import to avoid circular dependency with useTheme hook
  const resolvedTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  // Check if data-theme overrides
  const dt = document.documentElement.getAttribute("data-theme");
  const effective = dt === "dark" ? "dark" : dt === "light" ? "light" : resolvedTheme;
  saveTermPresetForTheme(id, effective);
  window.dispatchEvent(new CustomEvent("rssh:termpreset-change", { detail: id }));
}

/* ── Theme-linked preset resolution ── */

const DARK_PRESET_KEY = "rssh_termPreset_dark";
const LIGHT_PRESET_KEY = "rssh_termPreset_light";

/** Persist the current preset as the user's choice for the given resolved theme. */
export function saveTermPresetForTheme(presetId: string, resolvedTheme: "dark" | "light"): void {
  try {
    localStorage.setItem(
      resolvedTheme === "dark" ? DARK_PRESET_KEY : LIGHT_PRESET_KEY,
      presetId,
    );
  } catch { /* ignore */ }
}

/** Load the user's terminal preset for the given resolved theme. */
export function loadTermPresetForTheme(resolvedTheme: "dark" | "light"): string {
  try {
    const id = localStorage.getItem(
      resolvedTheme === "dark" ? DARK_PRESET_KEY : LIGHT_PRESET_KEY,
    );
    if (id && presets.some((p) => p.id === id)) return id;
  } catch { /* ignore */ }
  return resolvedTheme === "dark" ? "vscode-dark" : "vscode-light";
}

/** Resolve terminal theme based on current UI theme. */
export function resolveTermThemeForUITheme(uiTheme: "dark" | "light"): ITheme {
  return getTermPreset(loadTermPresetForTheme(uiTheme)).theme;
}
