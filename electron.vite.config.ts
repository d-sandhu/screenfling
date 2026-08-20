import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

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
    plugins: [react()],
  },
});
