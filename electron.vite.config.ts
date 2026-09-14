import { execFileSync } from "node:child_process";

import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

function buildCommit(): string {
  try {
    const value = process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8", timeout: 1_000 }).trim();
    return /^[a-f0-9]{40}$/u.test(value) ? value : "local";
  } catch { return "local"; }
}

export default defineConfig({
  main: {},
  preload: {
    build: {
      externalizeDeps: {
        exclude: ["zod"],
      },
    },
  },
  renderer: {
    define: { __SCREENFLING_BUILD__: JSON.stringify(buildCommit()) },
    plugins: [react()],
  },
});
