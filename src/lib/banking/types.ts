/**
 * What the Settings screen gets to see of the bank links. Safe for the browser: no session id, no state, no token,
 * no account number. (Everything else in src/lib/banking is server-only.)
 */
import type { Bank } from "@/lib/import/types";

export type ConnectionStatus = "active" | "expired" | "failed";

export interface BankLinkView {
  id: number;
  /** The arnaq account its transactions go into. */
  accountName: string;
  lastSyncedAt: string | null;
}

export interface BankConnectionView {
  id: number;
  bankName: string;
  bank: Bank | null;
  status: ConnectionStatus;
  /** Whole days of consent left (0 on the last day), or null when unknown. */
  daysLeft: number | null;
  links: BankLinkView[];
}

/** A bank that can be linked, from Enable Banking's list. */
export interface AspspOption {
  name: string;
  country: string;
  logo: string | null;
  maximumConsentValidity: number;
  bank: Bank;
}

/** The result of a refresh, per linked account. */
export interface SyncLinkReport {
  linkId: number;
  accountName: string;
  status: "ok" | "expired" | "failed";
  imported: number;
  duplicate: number;
  /** For a failure: a short English message (translated at the API edge). */
  error?: string;
}

/** What the bank flow ends with: shown as a short message in Settings. */
export const CALLBACK_RESULTS = [
  "linked",
  "cancelled",
  "expired",
  "failed",
  "noaccounts",
  "unavailable",
] as const;
export type CallbackResult = (typeof CALLBACK_RESULTS)[number];
export const isCallbackResult = (v: unknown): v is CallbackResult =>
  typeof v === "string" && (CALLBACK_RESULTS as readonly string[]).includes(v);

/** "Reconnect" shows from this many days before the consent ends. */
export const RECONNECT_DAYS = 14;
