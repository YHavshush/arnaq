"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { UnauthenticatedError, currentUser } from "@/lib/auth/session";
import { isEmail, isOtpType, passwordProblem, safeNext } from "@/lib/auth/validate";
import { checkRate, clientAddress, type Action } from "@/lib/auth/rate-limit";
import { supabaseServer } from "@/lib/supabase/server";

export type ErrorKey =
  | "invalid"
  | "email"
  | "short"
  | "long"
  | "mismatch"
  | "weak"
  | "notConfirmed"
  | "rate"
  | "generic"
  | "link";

/** What a form shows after it was submitted: an error, or "done, check your email". */
export type FormState = { error?: ErrorKey; sent?: { email: string }; email?: string } | null;

const text = (form: FormData, name: string) => {
  const v = form.get(name);
  return typeof v === "string" ? v : "";
};

/** Supabase's error codes, boiled down to what the person can act on (and nothing that tells apart who has an account). */
function mapError(error: { code?: string; status?: number }): ErrorKey {
  switch (error.code) {
    case "invalid_credentials":
      return "invalid";
    case "email_not_confirmed":
      return "notConfirmed";
    case "weak_password":
      return "weak";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
    case "over_sms_send_rate_limit":
      return "rate";
  }
  return error.status === 429 ? "rate" : "generic";
}

function passwordError(password: string, repeat?: string): ErrorKey | null {
  const problem = passwordProblem(password);
  if (problem) return problem;
  if (repeat !== undefined && repeat !== password) return "mismatch";
  return null;
}

/** Over the limit for this address or email: the same answer Supabase's own limit gives. */
async function overLimit(action: Action, email: string): Promise<boolean> {
  return !checkRate(action, clientAddress(await headers()), email);
}

export async function signIn(_prev: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").trim().toLowerCase();
  const password = text(form, "password");
  if (!isEmail(email)) return { error: "email", email };
  if (!password) return { error: "invalid", email };
  if (await overLimit("signIn", email)) return { error: "rate", email };
  const { error } = await (await supabaseServer()).auth.signInWithPassword({ email, password });
  if (error) return { error: mapError(error), email };
  redirect(safeNext(text(form, "next")));
}

export async function signUp(_prev: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").trim().toLowerCase();
  const password = text(form, "password");
  if (!isEmail(email)) return { error: "email", email };
  const bad = passwordError(password, text(form, "repeat"));
  if (bad) return { error: bad, email };
  if (await overLimit("signUp", email)) return { error: "rate", email };
  const { data, error } = await (await supabaseServer()).auth.signUp({ email, password });
  // An address that already has an account answers the same as a new one: nobody can use this form
  // to find out who has an account.
  if (error && error.code !== "user_already_exists") return { error: mapError(error), email };
  if (data?.session) redirect("/"); // the project does not require email confirmation
  return { sent: { email } };
}

export async function forgotPassword(_prev: FormState, form: FormData): Promise<FormState> {
  const email = text(form, "email").trim().toLowerCase();
  if (!isEmail(email)) return { error: "email", email };
  if (await overLimit("forgot", email)) return { error: "rate", email };
  const { error } = await (await supabaseServer()).auth.resetPasswordForEmail(email);
  if (error && mapError(error) === "rate") return { error: "rate", email };
  return { sent: { email } }; // the same answer whether or not the address has an account
}

export async function updatePassword(_prev: FormState, form: FormData): Promise<FormState> {
  try {
    await currentUser();
  } catch (e) {
    if (e instanceof UnauthenticatedError) redirect("/login");
    throw e;
  }
  const password = text(form, "password");
  const bad = passwordError(password, text(form, "repeat"));
  if (bad) return { error: bad };
  const { error } = await (await supabaseServer()).auth.updateUser({ password });
  if (error) return { error: mapError(error) };
  redirect("/");
}

/** The confirmation link only shows a button; this runs when it is pressed (mail scanners cannot burn the token). */
export async function confirmLink(_prev: FormState, form: FormData): Promise<FormState> {
  const tokenHash = text(form, "token_hash");
  const type = text(form, "type");
  if (!tokenHash || tokenHash.length > 300 || !isOtpType(type)) return { error: "link" };
  const supabase = await supabaseServer();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) return { error: "link" };
  if (type === "recovery") redirect("/reset-password");
  // The link is not tied to this browser, so it could have been requested by someone else: do not
  // stay signed in as whoever it belongs to. The address is confirmed; the person signs in themselves.
  await supabase.auth.signOut({ scope: "local" });
  redirect(`/login?confirmed=1&next=${encodeURIComponent(safeNext(text(form, "next")))}`);
}
