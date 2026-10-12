import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    environment: "node",
    // Tests talk to a real (in-process) Postgres; the heavy ones insert thousands of rows.
    testTimeout: 30_000,
    setupFiles: ["tests/setup.ts"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
