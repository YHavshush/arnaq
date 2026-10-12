import { describe, expect, it } from "vitest";
import { MIN_PASSWORD, isEmail, isOtpType, passwordProblem, safeNext } from "./validate";

describe("safeNext (no open redirects)", () => {
  it("keeps a path on this site, with its query", () => {
    expect(safeNext("/forecast?months=12")).toBe("/forecast?months=12");
    expect(safeNext("/")).toBe("/");
    expect(safeNext("/budget?month=2026-09")).toBe("/budget?month=2026-09");
  });

  it.each([
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "http://evil.example/x",
    "javascript:alert(1)",
    "evil.example",
    "/\t/evil.example",
    "/a\nb",
    "/foo\\bar",
    "",
    undefined,
    null,
    42,
    "/" + "a".repeat(300),
  ])("falls back for %j", (bad) => {
    expect(safeNext(bad)).toBe("/");
  });

  it("does not send people back to the auth pages (that would loop)", () => {
    for (const p of [
      "/login",
      "/register?x=1",
      "/forgot-password",
      "/auth/confirm",
      "/login/anything",
    ])
      expect(safeNext(p)).toBe("/");
    expect(safeNext("/loginfoo")).toBe("/loginfoo");
  });

  it("uses the given fallback", () => {
    expect(safeNext("//x", "/upload")).toBe("/upload");
  });
});

describe("input checks", () => {
  it("emails", () => {
    expect(isEmail("a@b.nl")).toBe(true);
    for (const bad of ["", "a", "a@b", "a b@c.nl", "@c.nl", `${"x".repeat(250)}@c.nl`, 5, null])
      expect(isEmail(bad)).toBe(false);
  });

  it("passwords need ten characters and at most 72 bytes", () => {
    expect(MIN_PASSWORD).toBe(10);
    expect(passwordProblem("short")).toBe("short");
    expect(passwordProblem("a".repeat(10))).toBeNull();
    expect(passwordProblem("a".repeat(73))).toBe("long");
    expect(passwordProblem("é".repeat(37))).toBe("long"); // 74 bytes
    expect(passwordProblem(undefined)).toBe("short");
  });

  it("link types", () => {
    expect(isOtpType("recovery")).toBe(true);
    expect(isOtpType("email")).toBe(true);
    for (const unused of ["signup", "invite", "magiclink"]) expect(isOtpType(unused)).toBe(false);
    expect(isOtpType("nope")).toBe(false);
    expect(isOtpType(undefined)).toBe(false);
  });
});
