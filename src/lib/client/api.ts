// Tiny fetch helper for the client components. Always resolves; a failure becomes a message in the page language.
export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

const nl = () => typeof document !== "undefined" && document.documentElement.lang.startsWith("nl");

export async function api<T = unknown>(
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    if (!res.ok)
      return {
        ok: false,
        error:
          data?.error ??
          (nl() ? `Er ging iets mis (${res.status}).` : `Something went wrong (${res.status}).`),
      };
    return { ok: true, data: data as T };
  } catch {
    return {
      ok: false,
      error: nl() ? "Geen verbinding. Probeer het opnieuw." : "No connection. Try again.",
    };
  }
}

/** "12,50" or "12.50" -> 1250 cents; null when it is not a plain positive amount. */
export function euroInputToCents(raw: string): number | null {
  const s = raw.trim().replace(/^€\s*/, "");
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.replace(",", ".").split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
