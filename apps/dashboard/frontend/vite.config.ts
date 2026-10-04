import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 3001,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
      },
      "/ws": {
        target: "ws://127.0.0.1:8081",
        ws: true,
      },
      "/metrics": {
        target: "http://127.0.0.1:8081",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "node",
    // Instantiates @kovanica/sdk-wasm before each test file imports lib/kvnc.ts.
    setupFiles: ["./vitest.setup.ts"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ["react", "react-dom", "zustand"],
          ui: ["@radix-ui/react-dialog", "@radix-ui/react-dropdown-menu", "@radix-ui/react-select", "@radix-ui/react-tooltip"],
          charts: ["recharts"],
          // Key handling is the Rust core in WASM, so it gets its own chunk.
          // The remaining @noble/hashes use is the non-secret asset-id hash in
          // AssetsPanel; it arrives via a subpath import, so a bare-specifier
          // manual chunk would come out empty and Rollup would drop it.
          wasm: ["@kovanica/sdk-wasm"],
          query: ["@tanstack/react-query"],
        },
      },
    },
  },
});