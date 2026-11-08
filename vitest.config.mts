import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const stub = fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url));

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": stub,
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "mock/**/*.test.ts"],
  },
});
