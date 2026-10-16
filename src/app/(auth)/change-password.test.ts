import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/auth/rate-limit";

const calls: { signIn: unknown[]; update: unknown[] } = { signIn: [], update: [] };
let currentPasswordIsRight = true;

vi.mock("next/headers", () => ({
  headers: async () => ({ get: (n: string) => (n === "x-forwarded-for" ? "203.0.113.9" : null) }),
  cookies: async () => ({ getAll: () => [], set: () => {} }),
}));
vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: {
      getClaims: async () => ({
        data: {
          claims: {
            sub: "00000000-0000-0000-0000-00000000000a",
            role: "authenticated",
            email: "me@example.com",
          },
        },
        error: null,
      }),
      signInWithPassword: async (args: unknown) => {
        calls.signIn.push(args);
        return currentPasswordIsRight
          ? { error: null }
          : { error: { code: "invalid_credentials", status: 400 } };
      },
      updateUser: async (args: unknown) => {
        calls.update.push(args);
        return { error: null };
      },
    },
  }),
}));

import { changePassword } from "./actions";

const form = (v: Record<string, string>) => {
  const f = new FormData();
  for (const [k, val] of Object.entries(v)) f.set(k, val);
  return f;
};
const good = {
  current: "old-password-1",
  password: "a-new-password-9",
  repeat: "a-new-password-9",
};

beforeEach(() => {
  resetRateLimits();
  calls.signIn = [];
  calls.update = [];
  currentPasswordIsRight = true;
});

describe("changePassword", () => {
  it("checks the current password, then sets the new one", async () => {
    expect(await changePassword(null, form(good))).toEqual({ done: true });
    expect(calls.signIn).toEqual([{ email: "me@example.com", password: "old-password-1" }]);
    expect(calls.update).toEqual([{ password: "a-new-password-9" }]);
  });

  it("a wrong current password changes nothing", async () => {
    currentPasswordIsRight = false;
    expect(await changePassword(null, form(good))).toEqual({ error: "currentWrong" });
    expect(calls.update).toEqual([]);
  });

  it("a missing current password, a short new one or two different ones never reach Supabase", async () => {
    expect(await changePassword(null, form({ ...good, current: "" }))).toEqual({
      error: "currentWrong",
    });
    expect(
      await changePassword(null, form({ ...good, password: "short", repeat: "short" })),
    ).toEqual({ error: "short" });
    expect(await changePassword(null, form({ ...good, repeat: "something-else-99" }))).toEqual({
      error: "mismatch",
    });
    expect(calls.signIn).toEqual([]);
    expect(calls.update).toEqual([]);
  });

  it("guessing the current password is limited like signing in is", async () => {
    currentPasswordIsRight = false;
    for (let i = 0; i < 6; i++)
      expect(await changePassword(null, form(good))).toEqual({ error: "currentWrong" });
    expect(await changePassword(null, form(good))).toEqual({ error: "rate" });
    expect(calls.signIn).toHaveLength(6);
  });
});
