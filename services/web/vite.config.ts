import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The web app talks to services/api. In dev we proxy /api to the local API service;
// until it exists, VITE_USE_MOCK=true (default) short-circuits to the in-memory mock layer.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true },
    },
  },
});
