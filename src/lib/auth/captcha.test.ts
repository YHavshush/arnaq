import { describe, expect, it } from "vitest";
import { captchaEnabled, captchaTokenOf, TURNSTILE_FIELD } from "./captcha";

const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;

describe("captcha", () => {
  it("is off without a site key and on with one", () => {
    expect(captchaEnabled(env({}))).toBe(false);
    expect(captchaEnabled(env({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "0x4AAA" }))).toBe(true);
  });

  it("reads the token from the form, and ignores an empty or huge one", () => {
    const form = (v: string) => {
      const f = new FormData();
      f.set(TURNSTILE_FIELD, v);
      return f;
    };
    expect(captchaTokenOf(form("abc"))).toBe("abc");
    expect(captchaTokenOf(form(""))).toBeUndefined();
    expect(captchaTokenOf(form("x".repeat(5000)))).toBeUndefined();
    expect(captchaTokenOf(new FormData())).toBeUndefined();
  });
});
