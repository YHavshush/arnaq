import { describe, expect, it, vi } from "vitest";
import { setClaims } from "../../../tests/helpers/test-user";

// tests/setup.ts replaces this module for everything else; here the real one is under test.
const real = await vi.importActual<typeof import("./session")>("./session");
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () =>
    (await import("@supabase/ssr")).createServerClient("", "", {
      cookies: { getAll: () => [], setAll: () => {} },
    }),
}));

describe("devAuthEnabled", () => {
  const on = { KASBOEK_DEV_AUTH: "1", NODE_ENV: "development" } as NodeJS.ProcessEnv;
  it("only in development, on a local database, and only when asked", () => {
    expect(real.devAuthEnabled(on)).toBe(true);
    expect(real.devAuthEnabled({ ...on, DATABASE_URL: "./data/pglite" })).toBe(true);
    expect(real.devAuthEnabled({ ...on, KASBOEK_DEV_AUTH: "0" })).toBe(false);
    expect(real.devAuthEnabled({ ...on, NODE_ENV: "production" })).toBe(false);
    expect(real.devAuthEnabled({ ...on, NODE_ENV: "test" })).toBe(false);
    expect(real.devAuthEnabled({ ...on, DATABASE_URL: "postgres://u:p@db.example/x" })).toBe(false);
    expect(real.devAuthEnabled({ ...on, DATABASE_URL: "postgresql://u:p@db.example/x" })).toBe(
      false,
    );
    expect(real.devAuthEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("currentUser", () => {
  it("returns the id and email of a verified session", async () => {
    setClaims({
      sub: "11111111-1111-1111-1111-111111111111",
      role: "authenticated",
      email: "x@example.com",
    });
    expect(await real.currentUser()).toEqual({
      id: "11111111-1111-1111-1111-111111111111",
      email: "x@example.com",
    });
    setClaims(undefined);
  });

  it("throws when nobody is signed in or the session is not a user's", async () => {
    for (const claims of [
      null,
      { role: "authenticated" },
      { sub: "11111111-1111-1111-1111-111111111111", role: "anon" },
      { sub: "11111111-1111-1111-1111-111111111111", role: "authenticated", is_anonymous: true },
    ]) {
      setClaims(claims);
      await expect(real.currentUser()).rejects.toBeInstanceOf(real.UnauthenticatedError);
    }
    setClaims(undefined);
  });
});

describe("hasRecentRecovery (a password may only be reset without the old one right after a recovery link)", () => {
  const now = 1_800_000_000;
  it("accepts a recent recovery or one-time-code sign-in", () => {
    expect(real.hasRecentRecovery([{ method: "recovery", timestamp: now - 60 }], now)).toBe(true);
    expect(real.hasRecentRecovery([{ method: "otp", timestamp: now - 600 }], now)).toBe(true);
  });
  it("refuses an old one, a password sign-in, and a missing record", () => {
    expect(real.hasRecentRecovery([{ method: "recovery", timestamp: now - 901 }], now)).toBe(false);
    expect(real.hasRecentRecovery([{ method: "password", timestamp: now - 5 }], now)).toBe(false);
    expect(real.hasRecentRecovery(undefined, now)).toBe(false);
    expect(real.hasRecentRecovery("nonsense", now)).toBe(false);
    expect(real.hasRecentRecovery([{ method: "recovery" }], now)).toBe(false);
  });
});
