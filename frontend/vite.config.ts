import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const backend = loadEnv(mode, ".", "VITE_").VITE_BACKEND_URL || "http://localhost:8000";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/api": backend,
        "/public": backend,
      },
    },
  };
});
