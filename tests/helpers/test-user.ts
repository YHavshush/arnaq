import { TEST_USER_A } from "@/db";
import { getRootDb } from "@/db/admin";
import type { Db } from "@/db";
import { withUser } from "@/db/scoped";

/** Which user the mocked session answers with (see tests/setup.ts). Defaults to TEST_USER_A. */
export function setTestUser(id: string | null): void {
  (globalThis as { __testUser?: string | null }).__testUser = id;
}

export const currentTestUser = (): string | null => {
  const g = globalThis as { __testUser?: string | null };
  return g.__testUser === undefined ? TEST_USER_A : g.__testUser;
};

/** Read or write the shared test database directly, as the current test user. */
export async function asTestUser<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const id = currentTestUser();
  if (!id) throw new Error("No test user set.");
  return await withUser(await getRootDb(), id, fn);
}
