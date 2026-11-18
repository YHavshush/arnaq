import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      // Tests run as the server: the marker resolves the way Next resolves it for server code (an empty module).
      // In a client bundle it throws, which is the point (src/lib/banking).
      "server-only": path.resolve(import.meta.dirname, "node_modules/server-only/empty.js"),
    },
  },
  test: {
    environment: "node",
    // Public values, only so the auth client can be built; tests never reach a real Supabase.
    env: {
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    },
    // Tests talk to a real (in-process) Postgres; the heavy ones insert thousands of rows.
    testTimeout: 30_000,
    setupFiles: ["tests/setup.ts"],
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
