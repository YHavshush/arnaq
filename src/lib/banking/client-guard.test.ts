// The Enable Banking client signs with the application's private key: it must never end up in a browser bundle. No
// file that runs in the browser ("use client") may import anything from src/lib/banking but the view types, nor may
// those types import anything else. (ESLint has the same rule for src/components; this covers every client file.)
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.join(process.cwd(), "src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const imports = (source: string) =>
  [
    ...source.matchAll(
      /(?:import|export)[^"']*?from\s*["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g,
    ),
  ].map((m) => m[1] ?? m[2]);

describe("the bank client stays on the server", () => {
  const all = files(SRC);
  const client = all.filter((f) => /^\s*["']use client["']/.test(readFileSync(f, "utf8")));

  it("finds the client files", () => {
    expect(client.length).toBeGreaterThan(10);
    expect(client.some((f) => f.endsWith("bank-connections.tsx"))).toBe(true);
  });

  it("no client file imports server banking code", () => {
    const bad = client.flatMap((f) =>
      imports(readFileSync(f, "utf8"))
        .filter(
          (spec) =>
            /(^@\/lib\/banking\/|\/banking\/)/.test(spec) && !/\/banking\/types$/.test(spec),
        )
        .map((spec) => `${path.relative(SRC, f)} -> ${spec}`),
    );
    expect(bad).toEqual([]);
  });

  it("the view types import nothing that could pull server code in", () => {
    const deps = imports(readFileSync(path.join(SRC, "lib/banking/types.ts"), "utf8"));
    expect(deps.every((d) => d === "@/lib/import/types")).toBe(true);
  });

  it("the client refuses to load in a browser, and its secrets are not public variables", () => {
    const source = readFileSync(path.join(SRC, "lib/banking/enable-banking.ts"), "utf8");
    expect(source).toMatch(/typeof window !== "undefined"/);
    expect(all.some((f) => readFileSync(f, "utf8").includes("NEXT_PUBLIC_ENABLE_BANKING"))).toBe(
      false,
    );
  });
});
