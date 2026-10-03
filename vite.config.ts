import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// One Vite build produces both the React client (static assets) and the Worker API.
// The PWA service worker is a small hand-written file in public/sw.js.
export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
});
