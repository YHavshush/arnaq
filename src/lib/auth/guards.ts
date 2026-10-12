import { redirect } from "next/navigation";
import { UnauthenticatedError, currentUser, type SessionUser } from "./session";

/** For the sign-in pages: someone who is already signed in has nothing to do there. */
export async function redirectIfSignedIn(to = "/"): Promise<void> {
  let signedIn = false;
  try {
    await currentUser();
    signedIn = true;
  } catch (e) {
    if (!(e instanceof UnauthenticatedError)) throw e;
  }
  if (signedIn) redirect(to);
}

/** For pages that need a session but no data (choosing a new password). */
export async function requireSignedIn(): Promise<SessionUser> {
  try {
    return await currentUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    throw e;
  }
}
