// Tiny fetch helper for the client components. Always resolves; errors become a Dutch message.
export type ApiResult<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

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
    if (!res.ok) return { ok: false, error: data?.error ?? `Er ging iets mis (${res.status}).` };
    return { ok: true, data: data as T };
  } catch {
    return { ok: false, error: "Geen verbinding. Probeer het opnieuw." };
  }
}

/** "12,50" or "12.50" -> 1250 cents; null when it is not a plain positive amount. */
export function euroInputToCents(raw: string): number | null {
  const s = raw.trim().replace(/^€\s*/, "");
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ""] = s.replace(",", ".").split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
