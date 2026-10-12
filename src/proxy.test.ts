import { NextRequest } from "next/server";
import { afterEach, describe, expect, it } from "vitest";
import { proxy } from "./proxy";
import { setClaims } from "../tests/helpers/test-user";

const ask = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  proxy(new NextRequest(`http://localhost:3000${path}`, init));
const next = (res: Response) => res.headers.get("x-middleware-next");
const location = (res: Response) => res.headers.get("location");

afterEach(() => setClaims(undefined));

describe("proxy: signed out", () => {
  it("sends pages to the login page and remembers where they were going", async () => {
    setClaims(null);
    const res = await ask("/forecast?months=12");
    expect(res.status).toBe(307);
    const to = new URL(location(res)!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("next")).toBe("/forecast?months=12");
  });

  it("answers APIs with 401 JSON, in the visitor's language", async () => {
    setClaims(null);
    const res = await ask("/api/review");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Not signed in." });
    const nl = await ask("/api/review", { headers: { cookie: "kasboek-lang=nl" } });
    expect(await nl.json()).toEqual({ error: "Je bent niet ingelogd." });
  });

  it("leaves the sign-in pages and the confirmation link open", async () => {
    setClaims(null);
    for (const p of [
      "/login",
      "/register",
      "/forgot-password",
      "/auth/confirm?token_hash=x&type=email",
    ])
      expect(next(await ask(p)), p).toBe("1");
  });

  it("closes everything else, including the reset page and logout", async () => {
    setClaims(null);
    for (const p of ["/", "/upload", "/settings", "/reset-password", "/auth/logout", "/api/export"])
      expect((await ask(p)).status, p).not.toBe(200);
  });

  it("does not put an unsafe return address in the login link", async () => {
    setClaims(null);
    const res = await ask("//evil.example/x");
    const to = new URL(location(res)!, "http://localhost:3000");
    expect(to.host).toBe("localhost:3000");
    expect(to.searchParams.get("next")).toBeNull();
  });

  it("treats a session whose role is not 'authenticated' as signed out", async () => {
    setClaims({ sub: "00000000-0000-0000-0000-00000000000a", role: "anon" });
    expect((await ask("/")).status).toBe(307);
  });
});

describe("proxy: signed in", () => {
  it("lets everything through", async () => {
    for (const p of ["/", "/upload", "/api/review", "/reset-password"])
      expect(next(await ask(p)), p).toBe("1");
  });

  it("sends the sign-in pages home", async () => {
    for (const p of ["/login", "/register", "/forgot-password"]) {
      const res = await ask(p);
      expect(res.status, p).toBe(307);
      expect(new URL(location(res)!).pathname).toBe("/");
    }
  });

  it("still blocks cross-site writes before anything else", async () => {
    const res = await ask("/api/rules", {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
    });
    expect(res.status).toBe(403);
    setClaims(null);
    expect(
      (
        await ask("/api/rules", {
          method: "POST",
          headers: { origin: "https://evil.example", host: "localhost:3000" },
        })
      ).status,
    ).toBe(403);
  });
});
