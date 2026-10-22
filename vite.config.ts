import { defineConfig } from "vite";

export default defineConfig({
  root: "web",
  build: { outDir: "../web-dist", emptyOutDir: true, chunkSizeWarningLimit: 650 },
  server: { proxy: { "/api": "http://127.0.0.1:3000" } },
});
