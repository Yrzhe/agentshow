import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), cloudflare(), tailwindcss()],

  // 端口钉在这里，不靠命令行传。scripts/seed.ts 不带 --base 时打的就是它，
  // 两边一旦不一致，无参数灌本地数据就会打到一个没人监听的端口上。
  server: { port: 5273, strictPort: true }
});
