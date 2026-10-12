// Source-level guards for the tenancy design (docs/plans/auth-tenancy.md).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const root = path.join(process.cwd(), "src");
const files = sources(root);
const rel = (f: string) => path.relative(process.cwd(), f);

describe("tenancy guards", () => {
  it("nothing but the request helper imports the unscoped root handle", () => {
    const offenders = files
      .filter((f) => /from "@\/db\/admin"|from "\.\.?\/.*db\/admin"/.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => f !== "src/lib/auth/request.ts");
    expect(offenders).toEqual([]);
  });

  it("no session-level user setting in app code (a pooled connection would keep it)", () => {
    const offenders = files
      .filter((f) => !rel(f).startsWith("src/db/")) // createDb sets it once for a single PGlite session
      .filter((f) => /set_config\([^)]*,\s*false\)/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("no data is cached across users with 'use cache'", () => {
    const offenders = files.filter((f) => /["']use cache/.test(readFileSync(f, "utf8"))).map(rel);
    expect(offenders).toEqual([]);
  });

  it("only withUser sets the per-request user", () => {
    const offenders = files
      .filter((f) => /set_config\('app\.user_id'/.test(readFileSync(f, "utf8")))
      .map(rel)
      .filter((f) => f !== "src/db/scoped.ts" && f !== "src/db/index.ts");
    expect(offenders).toEqual([]);
  });
});
