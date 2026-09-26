import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1460,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1461 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
});
