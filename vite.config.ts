import { defineConfig } from "vite";
import path from "node:path";
import electron from "vite-plugin-electron";
import renderer from "vite-plugin-electron-renderer";
import react from "@vitejs/plugin-react";

// Single `electron()` call with an array of entries.
// Calling `electron()` twice (as the previous config did) spawns two
// separate Electron processes during dev, and the second exiting kills the
// shared esbuild service with `Error: The service was stopped`.
//
// Auto-startup behavior: by default the plugin launches Electron after the
// FIRST entry whose build finishes. We provide `onstart` on preload and the
// worker so only main.ts auto-launches Electron. preload's onstart triggers
// a renderer reload on change; the worker is forked from main via
// utilityProcess.fork, so it must be compiled but must not trigger a second
// Electron launch of its own.

export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        entry: "electron/main.ts",
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      {
        entry: path.join(__dirname, "electron/preload.ts"),
        onstart({ reload }) {
          reload();
        },
        vite: {
          build: {
            outDir: "dist-electron",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
      {
        entry: "electron/workers/git-worker.ts",
        // Build-only — do not start a second Electron instance.
        onstart() {},
        vite: {
          build: {
            outDir: "dist-electron/workers",
            rollupOptions: {
              external: ["electron"],
            },
          },
        },
      },
    ]),
    process.env.NODE_ENV === "test" ? undefined : renderer({}),
  ],
});
