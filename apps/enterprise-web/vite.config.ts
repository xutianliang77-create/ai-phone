import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const proxyTarget = env.ENTERPRISE_API_PROXY_TARGET || "http://127.0.0.1:3000";
  return {
    plugins: [react()],
    server: {
      port: 4173,
      proxy: {
        "/api": {
          target: proxyTarget,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api/, ""),
        },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      restoreMocks: true,
      include: ["src/**/*.test.{ts,tsx}"],
    },
  };
});
