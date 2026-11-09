import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "../web-dist", emptyOutDir: true },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: process.env.MYTUNER_API_TARGET ?? "http://127.0.0.1:8777",
        changeOrigin: false,
      },
    },
  },
});
