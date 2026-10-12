/** Who is making this request. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in.");
  }
}

/** The one user of local development without a sign-in (see devAuthEnabled). */
export const DEV_USER_ID = "00000000-0000-0000-0000-0000000000d1";

/**
 * Local development without an auth server: `KASBOEK_DEV_AUTH=1`, only while running `next dev` on
 * a local database. A hosted database or a production build never accepts it, so this cannot
 * become a back door by a stray environment variable.
 */
export function devAuthEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.KASBOEK_DEV_AUTH !== "1") return false;
  if (env.NODE_ENV !== "development") return false;
  return !/^postgres(ql)?:\/\//i.test(env.DATABASE_URL?.trim() ?? "");
}

/**
 * The signed-in user's id, or throws UnauthenticatedError. Everything that reads or writes data
 * asks this first (through userDb).
 */
export async function currentUserId(): Promise<string> {
  if (devAuthEnabled()) return DEV_USER_ID;
  throw new UnauthenticatedError();
}
