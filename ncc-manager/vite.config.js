import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset URLs let the same build work from a site root, a named
  // NIP-5A/nsite path, or a local static preview directory.
  base: "./",
  plugins: [
    // Removed babel plugin for simplicity and to isolate issues.
  ],
  optimizeDeps: {
    include: ['lit'],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: 'workers/[name].js',
      },
    },
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
