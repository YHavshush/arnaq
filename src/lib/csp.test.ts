import { describe, expect, it } from "vitest";
import { cspHeader, cspMode } from "./csp";

const env = (e: Record<string, string>) => e as unknown as NodeJS.ProcessEnv;

describe("cspMode", () => {
  it("is off in development and report-only in production unless told otherwise", () => {
    expect(cspMode(env({ NODE_ENV: "development" }))).toBe("off");
    expect(cspMode(env({ NODE_ENV: "production" }))).toBe("report-only");
    expect(cspMode(env({ NODE_ENV: "production", CSP_MODE: "enforce" }))).toBe("enforce");
    expect(cspMode(env({ NODE_ENV: "production", CSP_MODE: "nonsense" }))).toBe("report-only");
  });
});

describe("cspHeader", () => {
  it("is not sent in development", () => {
    expect(cspHeader(env({ NODE_ENV: "development" }))).toBeNull();
  });

  it("uses the report-only header until enforced, and the same policy either way", () => {
    const report = cspHeader(env({ NODE_ENV: "production" }))!;
    const enforce = cspHeader(env({ NODE_ENV: "production", CSP_MODE: "enforce" }))!;
    expect(report.key).toBe("Content-Security-Policy-Report-Only");
    expect(enforce.key).toBe("Content-Security-Policy");
    expect(report.value).toBe(enforce.value);
  });

  it("closes what can be closed: other sites, framing, plugins, forms and base elsewhere", () => {
    const { value } = cspHeader(env({ NODE_ENV: "production" }))!;
    for (const d of [
      "default-src 'self'",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "connect-src 'self'",
    ])
      expect(value).toContain(d);
    expect(value).not.toMatch(/https?:|\*/); // nothing is allowed from another address
  });

  it("allows Cloudflare Turnstile only when it is switched on", () => {
    const off = cspHeader(env({ NODE_ENV: "production" }))!.value;
    const on = cspHeader(
      env({ NODE_ENV: "production", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "k" }),
    )!.value;
    expect(off).not.toContain("cloudflare");
    expect(on).toContain("script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com");
    expect(on).toContain("frame-src https://challenges.cloudflare.com");
    expect(on).toContain("connect-src 'self' https://challenges.cloudflare.com");
  });
});
