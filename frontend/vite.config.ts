import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "frappe-gantt/dist/frappe-gantt.css": path.resolve(__dirname, "./node_modules/frappe-gantt/dist/frappe-gantt.css"),
      "frappe-gantt": path.resolve(__dirname, "./node_modules/frappe-gantt/dist/frappe-gantt.es.js"),
    },
  },
  server: {
    host: true,
    port: 5173,
    strictPort: true,
    watch: { usePolling: true },
  },
});
