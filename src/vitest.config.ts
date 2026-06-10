import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": path.resolve(__dirname) } },
  test: {
    environment: "node", // UI smoke test opts into jsdom per-file
    include: ["lib/**/*.test.ts", "tests/**/*.test.{ts,tsx}"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
