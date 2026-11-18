import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";

/**
 * The Enable Banking API (PSD2 account information), server side only. Every request carries a short-lived token
 * (a JWT, RS256) signed with the application's private key; the key comes from the environment and never leaves this
 * file: it is not logged, not returned, not stored, and not part of any error message. Neither are the tokens, the
 * session ids or account numbers.
 *
 * The feature is off unless ENABLE_BANKING_APPLICATION_ID and ENABLE_BANKING_PRIVATE_KEY are set (and APP_URL, which
 * the bank sends the person back to). Calls go only to ENABLE_BANKING_API_URL (default the real API), never follow a
 * redirect, time out, and read at most a capped number of bytes. Everything that comes back is untrusted: the parsers
 * below keep only what arnaq needs, typed and length-capped.
 */
if (typeof window !== "undefined")
  throw new Error("The Enable Banking client is server-only and must never reach the browser.");

export const DEFAULT_API_URL = "https://api.enablebanking.com";
/** Tokens live an hour (the API accepts at most 24 hours). */
const TOKEN_TTL_SECONDS = 3600;
const TIMEOUT_MS = 15_000;
const DATA_TIMEOUT_MS = 20_000;
/** No answer arnaq needs is bigger than this; a bigger one is refused rather than read into memory. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_ASPSPS = 1000;
const MAX_ACCOUNTS = 20;
const MAX_PAGE_TRANSACTIONS = 5000;
const ASPSP_CACHE_MS = 60 * 60_000;

export interface BankingConfig {
  applicationId: string;
  key: KeyObject;
  baseUrl: URL;
}

/** Why a call failed: the HTTP status and the API's own error code (both safe to show and log), nothing else. */
export class EnableBankingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(`Enable Banking answered ${status}${code ? ` (${code})` : ""}.`);
    this.name = "EnableBankingError";
  }
}

/** Codes that mean the consent is over: the person has to link the bank again. */
export const SESSION_OVER = new Set(["EXPIRED_SESSION", "CLOSED_SESSION", "REVOKED_SESSION"]);
export const isSessionOver = (e: unknown): boolean =>
  e instanceof EnableBankingError && e.code !== null && SESSION_OVER.has(e.code);

const configCache = new Map<string, BankingConfig | null>();

/** The API's address: https only (plain http only for a local test server). Anything else switches the feature off. */
function apiUrl(raw: string | undefined): URL | null {
  if (!raw?.trim()) return new URL(DEFAULT_API_URL);
  try {
    const url = new URL(raw.trim());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return null;
    if (url.username || url.password) return null;
    return new URL(url.origin);
  } catch {
    return null;
  }
}

/**
 * The configuration, or null when the feature is off (a variable missing, or a key that is not an RSA private key).
 * The key may be given with literal `\n` escapes, as many hosts store multi-line values.
 */
export function bankingConfig(env: NodeJS.ProcessEnv = process.env): BankingConfig | null {
  const applicationId = env.ENABLE_BANKING_APPLICATION_ID?.trim() ?? "";
  const pem = env.ENABLE_BANKING_PRIVATE_KEY ?? "";
  if (!applicationId || !pem.trim() || !env.APP_URL?.trim()) return null;
  if (!/^[A-Za-z0-9-]{1,64}$/.test(applicationId)) return null;
  const baseUrl = apiUrl(env.ENABLE_BANKING_API_URL);
  if (!baseUrl) return null;
  const cacheKey = `${applicationId}|${baseUrl.origin}|${createHash("sha256").update(pem).digest("hex")}`;
  if (configCache.has(cacheKey)) return configCache.get(cacheKey)!;
  let config: BankingConfig | null = null;
  try {
    const key = createPrivateKey({ key: pem.replace(/\\n/g, "\n").trim(), format: "pem" });
    if (key.asymmetricKeyType === "rsa") config = { applicationId, key, baseUrl };
  } catch {
    // Deliberately silent about the content: whatever was in the variable stays out of the logs.
  }
  if (!config)
    console.warn("Enable Banking is off: ENABLE_BANKING_PRIVATE_KEY is not an RSA private key.");
  configCache.set(cacheKey, config);
  return config;
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

/** A signed token for the API: header {typ, alg RS256, kid = application id}, body {iss, aud, iat, exp}. */
export function signToken(config: BankingConfig, now: number = Date.now()): string {
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "RS256", kid: config.applicationId }));
  const body = b64url(
    JSON.stringify({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat,
      exp: iat + TOKEN_TTL_SECONDS,
    }),
  );
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${body}`), config.key);
  return `${header}.${body}.${b64url(signature)}`;
}

async function readCapped(res: Response): Promise<string> {
  const declared = Number(res.headers.get("content-length") ?? "0");
  if (declared > MAX_RESPONSE_BYTES) throw new EnableBankingError(502, "RESPONSE_TOO_LARGE");
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new EnableBankingError(502, "RESPONSE_TOO_LARGE");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

const errorCode = (body: unknown): string | null => {
  const code = (body as { error?: unknown } | null)?.error;
  return typeof code === "string" && /^[A-Z_]{1,64}$/.test(code) ? code : null;
};

/** One call. The path is built by this file from fixed parts and encoded ids, and must stay on the API's host. */
async function call(
  config: BankingConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: { query?: Record<string, string | undefined>; body?: unknown; timeoutMs?: number } = {},
): Promise<unknown> {
  const url = new URL(path, config.baseUrl);
  if (url.origin !== config.baseUrl.origin) throw new EnableBankingError(0, "INVALID_HOST");
  for (const [k, v] of Object.entries(opts.query ?? {}))
    if (v !== undefined) url.searchParams.set(k, v);
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${signToken(config)}`,
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    const timeout = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    throw new EnableBankingError(0, timeout ? "TIMEOUT" : "NETWORK");
  }
  let text: string;
  try {
    text = await readCapped(res);
  } catch (e) {
    // A body cut off or timed out while reading: the driver's own error could name the address, so it stays here.
    if (e instanceof EnableBankingError) throw e;
    throw new EnableBankingError(0, "NETWORK");
  }
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    if (res.ok) throw new EnableBankingError(502, "INVALID_RESPONSE");
  }
  if (!res.ok) throw new EnableBankingError(res.status, errorCode(body));
  return body;
}

// ---- parsing what comes back (untrusted) ----

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 && v.length <= max ? v : null;
const invalid = () => new EnableBankingError(502, "INVALID_RESPONSE");

/** An instant from the API as an ISO string, or null when it is not one (or absurdly far away). */
export function isoInstant(v: unknown): string | null {
  const s = str(v, 64);
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return null;
  const t = Date.parse(s);
  if (!Number.isFinite(t)) return null;
  const year = new Date(t).getUTCFullYear();
  return year >= 2000 && year <= 2100 ? new Date(t).toISOString() : null;
}

export const normaliseIban = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, "").toUpperCase() : "";
  return /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s) ? s : null;
};

export interface Aspsp {
  name: string;
  country: string;
  logo: string | null;
  /** Longest consent the bank gives, in seconds. */
  maximumConsentValidity: number;
  psuTypes: string[];
  beta: boolean;
}

export function parseAspsps(body: unknown): Aspsp[] {
  const list = obj(body)?.aspsps;
  if (!Array.isArray(list)) throw invalid();
  const out: Aspsp[] = [];
  for (const raw of list.slice(0, MAX_ASPSPS)) {
    const a = obj(raw);
    const name = str(a?.name, 100);
    const country = str(a?.country, 2);
    const validity = a?.maximum_consent_validity;
    if (!a || !name || !country || !/^[A-Z]{2}$/.test(country)) continue;
    if (typeof validity !== "number" || !Number.isSafeInteger(validity) || validity <= 0) continue;
    const logo = str(a.logo, 500);
    out.push({
      name,
      country,
      logo: logo && logo.startsWith("https://") ? logo : null,
      maximumConsentValidity: validity,
      psuTypes: Array.isArray(a.psu_types)
        ? a.psu_types.filter((p): p is string => p === "personal" || p === "business")
        : [],
      beta: a.beta === true,
    });
  }
  return out;
}

const aspspCache = new Map<string, { at: number; list: Aspsp[] }>();

/** The banks in a country (cached for the process for an hour: the list hardly changes). */
export async function getAspsps(
  config: BankingConfig,
  country: string,
  now: number = Date.now(),
): Promise<Aspsp[]> {
  if (!/^[A-Z]{2}$/.test(country)) throw new EnableBankingError(400, "WRONG_REQUEST_PARAMETERS");
  const key = `${config.baseUrl.origin}|${config.applicationId}|${country}`;
  const hit = aspspCache.get(key);
  if (hit && now - hit.at < ASPSP_CACHE_MS) return hit.list;
  const list = parseAspsps(await call(config, "GET", "/aspsps", { query: { country } }));
  aspspCache.set(key, { at: now, list });
  return list;
}

/** For tests. */
export function clearBankingCaches(): void {
  aspspCache.clear();
  configCache.clear();
}

export interface StartAuthorization {
  validUntil: string;
  aspsp: { name: string; country: string };
  state: string;
  redirectUrl: string;
  language: "en" | "nl";
}

/** POST /auth: where to send the person to give their consent at the bank. */
export async function startAuthorization(
  config: BankingConfig,
  input: StartAuthorization,
): Promise<{ url: string }> {
  const body = obj(
    await call(config, "POST", "/auth", {
      body: {
        access: { valid_until: input.validUntil },
        aspsp: input.aspsp,
        state: input.state,
        redirect_url: input.redirectUrl,
        psu_type: "personal",
        language: input.language,
      },
    }),
  );
  const raw = str(body?.url, 2000);
  let url: URL;
  try {
    url = new URL(raw ?? "");
  } catch {
    throw invalid();
  }
  // The browser is sent there: never anything but a secure web address.
  if (url.protocol !== "https:" || url.username || url.password) throw invalid();
  return { url: url.toString() };
}

export interface SessionAccount {
  uid: string;
  iban: string | null;
  currency: string;
  name: string | null;
}

export interface Session {
  sessionId: string;
  validUntil: string | null;
  accounts: SessionAccount[];
}

export function parseSession(raw: unknown): Session {
  const body = obj(raw);
  const sessionId = str(body?.session_id, 100);
  if (!body || !sessionId || !/^[A-Za-z0-9-]+$/.test(sessionId)) throw invalid();
  const accounts: SessionAccount[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(body.accounts) ? body.accounts.slice(0, MAX_ACCOUNTS) : []) {
    const a = obj(item);
    const uid = str(a?.uid, 100);
    if (!a || !uid || !/^[A-Za-z0-9-]+$/.test(uid) || seen.has(uid)) continue;
    seen.add(uid);
    const currency = str(a.currency, 3);
    accounts.push({
      uid,
      iban: normaliseIban(obj(a.account_id)?.iban),
      currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : "EUR",
      name: str(a.name, 200),
    });
  }
  return { sessionId, validUntil: isoInstant(obj(body.access)?.valid_until), accounts };
}

/** POST /sessions: turn the code the bank sent back into a session with the accounts the person allowed. */
export async function createSession(config: BankingConfig, code: string): Promise<Session> {
  return parseSession(await call(config, "POST", "/sessions", { body: { code } }));
}

/** DELETE /sessions/{id}: end the consent. A session that is already gone counts as done. */
export async function deleteSession(config: BankingConfig, sessionId: string): Promise<void> {
  try {
    await call(config, "DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
  } catch (e) {
    if (
      e instanceof EnableBankingError &&
      (e.status === 404 ||
        e.code === "SESSION_DOES_NOT_EXIST" ||
        (e.code !== null && SESSION_OVER.has(e.code)))
    )
      return;
    throw e;
  }
}

export interface Balance {
  type: string;
  amount: string;
  currency: string;
  referenceDate: string | null;
  lastCommittedTransaction: string | null;
}

export function parseBalances(raw: unknown): Balance[] {
  const list = obj(raw)?.balances;
  if (!Array.isArray(list)) throw invalid();
  const out: Balance[] = [];
  for (const item of list.slice(0, 50)) {
    const b = obj(item);
    const amount = obj(b?.balance_amount);
    const type = str(b?.balance_type, 4);
    const value = str(amount?.amount, 32);
    const currency = str(amount?.currency, 3);
    if (!b || !type || !value || !currency) continue;
    const date = str(b.reference_date, 10);
    out.push({
      type,
      amount: value,
      currency,
      referenceDate: date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
      lastCommittedTransaction: str(b.last_committed_transaction, 200),
    });
  }
  return out;
}

export async function getBalances(config: BankingConfig, accountUid: string): Promise<Balance[]> {
  return parseBalances(
    await call(config, "GET", `/accounts/${encodeURIComponent(accountUid)}/balances`, {
      timeoutMs: DATA_TIMEOUT_MS,
    }),
  );
}

export interface TransactionPage {
  /** Raw transactions: turned into rows by src/lib/banking/convert.ts, which checks every field. */
  transactions: unknown[];
  continuationKey: string | null;
}

export function parseTransactionPage(raw: unknown): TransactionPage {
  const body = obj(raw);
  if (!body || !Array.isArray(body.transactions)) throw invalid();
  if (body.transactions.length > MAX_PAGE_TRANSACTIONS) throw invalid();
  return {
    transactions: body.transactions,
    continuationKey: str(body.continuation_key, 2000),
  };
}

/** One page of booked transactions. */
export async function getTransactions(
  config: BankingConfig,
  accountUid: string,
  query: { dateFrom: string; dateTo: string; continuationKey?: string | null },
): Promise<TransactionPage> {
  return parseTransactionPage(
    await call(config, "GET", `/accounts/${encodeURIComponent(accountUid)}/transactions`, {
      query: {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        transaction_status: "BOOK",
        strategy: "default",
        continuation_key: query.continuationKey ?? undefined,
      },
      timeoutMs: DATA_TIMEOUT_MS,
    }),
  );
}
