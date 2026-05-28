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
    port: 3001,
     proxy: {                              // ← ADD THIS
      "/api": {
        target: "http://localhost:8085",
        changeOrigin: true,
      },
      "/login": {
        target: "http://localhost:8085",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:8085",
        changeOrigin: true,
      },
    },   
  },
});