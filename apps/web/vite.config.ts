import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: 5173,
    // Dev only: forward API calls so the browser sees one origin (the API has
    // no CORS). Used when VITE_API_BASE_URL is set to "" (see ops/docker-compose.yml).
    proxy: { "/v1": { target: process.env.VITE_PROXY_TARGET ?? "http://localhost:3000", changeOrigin: true } },
  },
});
