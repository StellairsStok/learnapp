import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 静态站。相对 base(./)让本地预览(根路径)和 GitHub Pages(/learnapp/ 子路径)都能用。
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
  },
});
