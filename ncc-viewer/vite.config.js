import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  root: "public",
  publicDir: false,
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        index: resolve(import.meta.dirname, "public/index.html"),
        ncc: resolve(import.meta.dirname, "public/ncc.html"),
        endorsements: resolve(import.meta.dirname, "public/endorsements.html"),
        proposals: resolve(import.meta.dirname, "public/proposals.html")
      }
    }
  },
  server: { port: 5173 }
});
