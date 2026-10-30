import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // apps/web already owns 5173.
    // 5174 clashes with storybook on my machine — am
    port: 5174,
    // Dev only: forward API calls so the browser sees one origin (the API has
    // no CORS). Used when VITE_ADMIN_API_BASE_URL is set to "" (see ops/docker-compose.yml).
    proxy: { "/v1": { target: process.env.VITE_PROXY_TARGET ?? "http://localhost:3000", changeOrigin: true } },
  },
});
