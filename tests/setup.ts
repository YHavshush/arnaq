import { vi } from "vitest";

// connection() only works inside a Next.js request. Route handlers are called directly in tests.
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  connection: async () => {},
}));

// There is no sign-in in tests: the session answers with the user a test picks (default: user A).
// null means signed out. Nothing like this exists in the application code.
vi.mock("@/lib/auth/session", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/auth/session")>();
  return {
    ...real,
    currentUserId: async () => {
      const g = globalThis as { __testUser?: string | null };
      const id = g.__testUser === undefined ? "00000000-0000-0000-0000-00000000000a" : g.__testUser;
      if (!id) throw new real.UnauthenticatedError();
      return id;
    },
  };
});
