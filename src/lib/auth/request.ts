import { redirect } from "next/navigation";
import { getRootDb } from "@/db/admin";
import type { Db } from "@/db";
import { withUser } from "@/db/scoped";
import { UnauthenticatedError, currentUserId } from "./session";

/**
 * The only way app code reaches the database: as the signed-in user, in one transaction. Throws
 * UnauthenticatedError when nobody is signed in (APIs answer 401, pages redirect to the login).
 * Do the data loading inside `fn` and render outside it: the transaction holds a connection.
 */
export async function userDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const userId = await currentUserId();
  return await withUser(await getRootDb(), userId, fn);
}

/** For pages: like userDb, but a visitor who is not signed in is sent to the login page. */
export async function pageDb<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await userDb(fn);
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    throw e;
  }
}
