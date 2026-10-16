import { describe, expect, it } from "vitest";
import { appUrl, redirectTarget } from "./app-url";

describe("appUrl", () => {
  it("keeps only the origin, and only for http and https", () => {
    expect(appUrl({ APP_URL: "https://kasboek.example/some/path?x=1" } as never)?.href).toBe(
      "https://kasboek.example/",
    );
    expect(appUrl({ APP_URL: " http://localhost:3300 " } as never)?.host).toBe("localhost:3300");
    for (const bad of [
      "",
      "   ",
      "javascript:alert(1)",
      "ftp://x.example",
      "not a url",
      "//x.example",
    ])
      expect(appUrl({ APP_URL: bad } as never), bad).toBeNull();
    expect(appUrl({} as never)).toBeNull();
  });

  it("redirects to the configured address, else to the request's own", () => {
    expect(
      redirectTarget("/login", "http://internal:3000/x", { APP_URL: "https://k.example" } as never)
        .href,
    ).toBe("https://k.example/login");
    expect(redirectTarget("/login", "http://localhost:3000/x", {} as never).href).toBe(
      "http://localhost:3000/login",
    );
  });
});
