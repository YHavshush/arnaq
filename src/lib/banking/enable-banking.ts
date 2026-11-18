import "server-only";
import { createHash, createPrivateKey, sign, type KeyObject } from "node:crypto";
import { isIP } from "node:net";

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
let warnedUrl = false;

/**
 * The API's address: https only (plain http only for a local test server, and never in production). Anything else
 * switches the feature off, with one warning that does not repeat the value.
 */
function apiUrl(env: NodeJS.ProcessEnv): URL | null {
  const raw = env.ENABLE_BANKING_API_URL;
  if (!raw?.trim()) return new URL(DEFAULT_API_URL);
  let ok: URL | null = null;
  try {
    const url = new URL(raw.trim());
    const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    const plainLocal = url.protocol === "http:" && local && env.NODE_ENV !== "production";
    if ((url.protocol === "https:" || plainLocal) && !url.username && !url.password)
      ok = new URL(url.origin);
  } catch {
    ok = null;
  }
  if (!ok && !warnedUrl) {
    warnedUrl = true;
    console.warn("Enable Banking is off: ENABLE_BANKING_API_URL is not an https address.");
  }
  return ok;
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
  const baseUrl = apiUrl(env);
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

declare const psuBrand: unique symbol;

/**
 * The "PSU headers": they tell the bank the person is there right now (they pressed Refresh), which PSD2 treats
 * differently from reading in the background. Only psuHeadersFromRequest makes them, from the request of the person who
 * pressed the button, and only from values that pass a strict check; a plain object is not one (the brand).
 */
export type PsuHeaders = Readonly<Record<string, string>> & { readonly [psuBrand]: true };

const PSU_RULES: [header: string, psu: string, max: number, ok: RegExp][] = [
  ["user-agent", "Psu-User-Agent", 300, /^[\x20-\x7e]+$/],
  ["accept-language", "Psu-Accept-Language", 100, /^[A-Za-z0-9\-,;=.* ]+$/],
  ["accept", "Psu-Accept", 200, /^[A-Za-z0-9\-,;=.*/+ ]+$/],
  ["accept-encoding", "Psu-Accept-Encoding", 100, /^[A-Za-z0-9\-,;=.* ]+$/],
  ["accept-charset", "Psu-Accept-Charset", 100, /^[A-Za-z0-9\-,;=.* ]+$/],
];

/**
 * PSU headers from the request of a person who pressed "Refresh now", or null. The address is the first entry of
 * x-forwarded-for and must be an IP address; without one, none are sent at all (Enable Banking wants all of a bank's
 * required headers or none). The others are passed on only when present and well-formed, capped in length.
 */
export function psuHeadersFromRequest(headers: {
  get(name: string): string | null;
}): PsuHeaders | null {
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  if (ip.length > 45 || isIP(ip) === 0) return null;
  const out: Record<string, string> = { "Psu-Ip-Address": ip };
  for (const [header, psu, max, ok] of PSU_RULES) {
    const value = headers.get(header)?.trim().slice(0, max);
    if (value && ok.test(value)) out[psu] = value;
  }
  return out as PsuHeaders;
}

type CallOptions = {
  query?: Record<string, string | undefined>;
  body?: unknown;
  timeoutMs?: number;
  psu?: PsuHeaders | null;
};

/** One call. The path is built by this file from fixed parts and encoded ids, and must stay on the API's host. */
async function call(
  config: BankingConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: CallOptions = {},
): Promise<unknown> {
  return (await request(config, method, path, opts)).body;
}

/** A call, and how many bytes its answer had (the sync keeps a budget). */
async function request(
  config: BankingConfig,
  method: "GET" | "POST" | "DELETE",
  path: string,
  opts: CallOptions = {},
): Promise<{ body: unknown; bytes: number }> {
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
      signal: AbortSignal.timeout(Math.max(1, opts.timeoutMs ?? TIMEOUT_MS)),
      headers: {
        accept: "application/json",
        authorization: `Bearer ${signToken(config)}`,
        ...(opts.body === undefined ? {} : { "content-type": "application/json" }),
        ...(opts.psu ?? {}),
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
  return { body, bytes: Buffer.byteLength(text) };
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

/** The IBAN check (ISO 13616, mod 97): letters become numbers, the first four characters go to the end. */
export function ibanChecksumOk(iban: string): boolean {
  const moved = iban.slice(4) + iban.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const digits = /[A-Z]/.test(ch) ? String(ch.charCodeAt(0) - 55) : ch;
    for (const d of digits) rest = (rest * 10 + Number(d)) % 97;
  }
  return rest === 1;
}

/** An IBAN without spaces, upper case, with a valid check digit; null otherwise. */
export const normaliseIban = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.replace(/\s+/g, "").toUpperCase() : "";
  return /^[A-Z]{2}\d{2}[A-Z0-9]{8,30}$/.test(s) && ibanChecksumOk(s) ? s : null;
};

/** How an account number is shown: the last four characters only ("••1234"). */
export const maskIban = (iban: string): string => `••${iban.slice(-4)}`;

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

export type BankingEnvironment = "PRODUCTION" | "SANDBOX";

/** GET /application: the environment of this application (Enable Banking tells them apart by application). */
export async function getApplicationEnvironment(
  config: BankingConfig,
): Promise<BankingEnvironment> {
  const environment = obj(await call(config, "GET", "/application"))?.environment;
  if (environment !== "PRODUCTION" && environment !== "SANDBOX") throw invalid();
  return environment;
}

/** A known environment is kept for the process (it never changes for an application); a failure for a minute. */
const APPLICATION_RETRY_MS = 60_000;
const environmentCache = new Map<
  string,
  { environment: BankingEnvironment } | { failedAt: number }
>();

export type BankingStatus =
  | { state: "off" }
  | { state: "sandbox" }
  | { state: "unreachable" }
  | { state: "on"; config: BankingConfig; environment: BankingEnvironment };

/**
 * Whether linking banks works here. Off without the variables. A sandbox (test) application is refused in production
 * unless ENABLE_BANKING_ALLOW_SANDBOX=1, so test data never lands in a real database. When Enable Banking cannot say
 * which application this is, the feature is unavailable (fail closed), and it asks again after a minute.
 */
export async function bankingStatus(
  env: NodeJS.ProcessEnv = process.env,
  now: number = Date.now(),
): Promise<BankingStatus> {
  const config = bankingConfig(env);
  if (!config) return { state: "off" };
  const key = `${config.baseUrl.origin}|${config.applicationId}`;
  let hit = environmentCache.get(key);
  if (!hit || ("failedAt" in hit && now - hit.failedAt >= APPLICATION_RETRY_MS)) {
    try {
      hit = { environment: await getApplicationEnvironment(config) };
    } catch {
      hit = { failedAt: now };
    }
    environmentCache.set(key, hit);
  }
  if ("failedAt" in hit) return { state: "unreachable" };
  if (
    hit.environment === "SANDBOX" &&
    env.NODE_ENV === "production" &&
    env.ENABLE_BANKING_ALLOW_SANDBOX !== "1"
  )
    return { state: "sandbox" };
  return { state: "on", config, environment: hit.environment };
}

/** For tests. */
export function clearBankingCaches(): void {
  aspspCache.clear();
  configCache.clear();
  environmentCache.clear();
  warnedUrl = false;
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

export async function getBalances(
  config: BankingConfig,
  accountUid: string,
  timeoutMs: number = DATA_TIMEOUT_MS,
  psu: PsuHeaders | null = null,
): Promise<Balance[]> {
  return parseBalances(
    await call(config, "GET", `/accounts/${encodeURIComponent(accountUid)}/balances`, {
      timeoutMs: Math.min(DATA_TIMEOUT_MS, timeoutMs),
      psu,
    }),
  );
}

export interface TransactionPage {
  /** Raw transactions: turned into rows by src/lib/banking/convert.ts, which checks every field. */
  transactions: unknown[];
  continuationKey: string | null;
  /** Size of the answer in bytes, for the sync's budget. */
  bytes: number;
}

export function parseTransactionPage(raw: unknown, bytes = 0): TransactionPage {
  const body = obj(raw);
  if (!body || !Array.isArray(body.transactions)) throw invalid();
  if (body.transactions.length > MAX_PAGE_TRANSACTIONS) throw invalid();
  return {
    transactions: body.transactions,
    continuationKey: str(body.continuation_key, 2000),
    bytes,
  };
}

/** One page of booked transactions. `timeoutMs` shortens the usual timeout (a sync near its deadline). */
export async function getTransactions(
  config: BankingConfig,
  accountUid: string,
  query: {
    dateFrom: string;
    dateTo: string;
    continuationKey?: string | null;
    timeoutMs?: number;
    psu?: PsuHeaders | null;
  },
): Promise<TransactionPage> {
  const { body, bytes } = await request(
    config,
    "GET",
    `/accounts/${encodeURIComponent(accountUid)}/transactions`,
    {
      query: {
        date_from: query.dateFrom,
        date_to: query.dateTo,
        transaction_status: "BOOK",
        strategy: "default",
        continuation_key: query.continuationKey ?? undefined,
      },
      timeoutMs: Math.min(DATA_TIMEOUT_MS, query.timeoutMs ?? DATA_TIMEOUT_MS),
      psu: query.psu ?? null,
    },
  );
  return parseTransactionPage(body, bytes);
}
