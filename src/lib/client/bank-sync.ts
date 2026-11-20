import { api } from "@/lib/client/api";
import type { SyncLinkReport } from "@/lib/banking/types";

export interface SyncStrings {
  refreshed: (count: number) => string;
  refreshProblem: (account: string, problem: string) => string;
  refreshExpired: (account: string) => string;
}

/** What a refresh came to, in words: one line for the toast when something was fetched, and a line per problem. */
export interface SyncOutcome {
  /** The request itself failed (too many requests, no connection, not set up): the only line to show. */
  error: string | null;
  message: string | null;
  problems: string[];
}

/** "Refresh now" for every active bank link: the same call from the Settings button and the pull down. */
export async function syncBanks(s: SyncStrings): Promise<SyncOutcome> {
  const res = await api<{ links: SyncLinkReport[] }>("POST", "/api/banking/sync");
  if (!res.ok) return { error: res.error, message: null, problems: [] };
  const links = res.data.links;
  const imported = links.reduce((n, l) => n + (l.status === "ok" ? l.imported : 0), 0);
  return {
    error: null,
    message: links.some((l) => l.status === "ok") ? s.refreshed(imported) : null,
    problems: links.flatMap((l) =>
      l.status === "expired"
        ? [s.refreshExpired(l.accountName)]
        : l.status === "failed" || l.status === "stopped"
          ? [s.refreshProblem(l.accountName, l.error ?? "")]
          : [],
    ),
  };
}
