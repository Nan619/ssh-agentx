import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  clearScreen: false,
  // ── @xterm/xterm bundling fix ───────────────────────────────
  // Vite's esbuild pre-bundler can corrupt xterm.js internals
  // (e.g., variable "i" stripped in requestMode), causing a
  // ReferenceError that breaks escape-sequence parsing. This
  // makes vim/top/less appear frozen even though input reaches
  // the PTY correctly.
  //
  // FIX: Exclude xterm from dependency pre-bundling (dev) and
  // disable minification for production builds.
  optimizeDeps: {
    exclude: ["@xterm/xterm"],
  },
  build: {
    minify: false,
  },
  // ────────────────────────────────────────────────────────────
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
