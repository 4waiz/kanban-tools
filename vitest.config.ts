import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // `server-only` throws if imported outside a React Server Component build.
      // In unit tests we stub it with a harmless empty module.
      "server-only": path.resolve(__dirname, "./test/server-only-stub.ts"),
    },
  },
});
