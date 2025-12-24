import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    include: ['lit'],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 5173,
    host: true,
    force: true,
    proxy: {
      "/api": "http://localhost:5179"
    }
  }
});