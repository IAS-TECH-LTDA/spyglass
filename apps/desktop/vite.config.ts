import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://v2.tauri.app/start/frontend/vite/
export default defineConfig({
  plugins: [react()],

  // Tauri expects a fixed dev server port; fail instead of silently
  // picking another one so `tauri dev` never points at a stale window.
  server: {
    port: 1420,
    strictPort: true,
  },

  // Tauri injects TAURI_* env vars; expose them (and our own VITE_ ones)
  // to the client bundle.
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    target: process.env.TAURI_ENV_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
});
