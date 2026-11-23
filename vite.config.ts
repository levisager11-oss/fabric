import { defineConfig } from "vite";

// Relative base: the build runs from any folder (Toki subdomain, itch.io, GitHub Pages).
export default defineConfig({
  base: "./",
  build: { target: "es2020", assetsInlineLimit: 0 },
});
