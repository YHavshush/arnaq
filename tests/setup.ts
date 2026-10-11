import { vi } from "vitest";

// connection() only works inside a Next.js request. Route handlers are called directly in tests.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));
