import { beforeEach, describe, expect, it } from "vitest";
import { RULES, allow, checkRate, clientAddress, resetRateLimits } from "./rate-limit";

beforeEach(resetRateLimits);

describe("allow", () => {
  it("lets max tries through inside the window, then refuses, then lets go as time passes", () => {
    const rule = { max: 3, windowMs: 1000 };
    expect([0, 100, 200].map((t) => allow("k", rule, t))).toEqual([true, true, true]);
    expect(allow("k", rule, 300)).toBe(false);
    expect(allow("k", rule, 900)).toBe(false); // refused tries are not counted
    expect(allow("k", rule, 1001)).toBe(true); // the first one has left the window
    expect(allow("other", rule, 300)).toBe(true); // keys are independent
  });
});

describe("checkRate", () => {
  it("limits one email even when the address changes, and one address even when the email changes", () => {
    const { email, ip } = RULES.forgot;
    for (let i = 0; i < email.max; i++)
      expect(checkRate("forgot", `10.0.0.${i}`, "a@b.nl", i)).toBe(true);
    expect(checkRate("forgot", "10.9.9.9", "A@B.NL", 10)).toBe(false); // same email, new address, any casing
    resetRateLimits();
    for (let i = 0; i < ip.max; i++)
      expect(checkRate("forgot", "10.0.0.1", `p${i}@b.nl`, i)).toBe(true);
    expect(checkRate("forgot", "10.0.0.1", "new@b.nl", 10)).toBe(false);
  });

  it("each action has its own counts", () => {
    for (let i = 0; i < RULES.signUp.email.max; i++) checkRate("signUp", "1.1.1.1", "a@b.nl", i);
    expect(checkRate("signUp", "1.1.1.1", "a@b.nl", 10)).toBe(false);
    expect(checkRate("signIn", "1.1.1.1", "a@b.nl", 10)).toBe(true);
  });
});

describe("clientAddress", () => {
  const headers = (h: Record<string, string>) => ({
    get: (n: string) => h[n.toLowerCase()] ?? null,
  });
  it("uses the first forwarded address, then x-real-ip, and survives nothing", () => {
    expect(clientAddress(headers({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" }))).toBe(
      "203.0.113.5",
    );
    expect(clientAddress(headers({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientAddress(headers({}))).toBe("unknown");
    expect(clientAddress(headers({ "x-forwarded-for": "x".repeat(500) })).length).toBe(64);
  });
});
