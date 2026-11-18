"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import {
  RECONNECT_DAYS,
  isCallbackResult,
  type AspspOption,
  type BankConnectionView,
  type CallbackResult,
  type SyncLinkReport,
} from "@/lib/banking/types";
import { formatter } from "@/lib/view/format";
import { ErrorLine, GhostButton, PrimaryButton } from "./form";
import { SlideOrButton } from "./slide-to-confirm";
import { StatusChip } from "./status-chip";
import { useToast } from "./toast";
import { useAction } from "./use-action";

/** The banks offered when linking: the Netherlands, where all of arnaq's banks are. */
const COUNTRY = "NL";

/**
 * Bank connections in Settings: link a bank through Enable Banking, refresh, reconnect before the consent ends, and
 * disconnect (asks first). The result of a trip to the bank arrives as `?bank=<result>`; only known words are shown.
 */
export function BankConnections({
  configured,
  connections,
}: {
  configured: boolean;
  connections: BankConnectionView[];
}) {
  const { t, locale } = useI18n();
  const s = t.ui.banking;
  const { dayLabel } = formatter(locale);
  const router = useRouter();
  const params = useSearchParams();
  const { toast } = useToast();
  const [picking, setPicking] = useState(false);
  const [confirming, setConfirming] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [problems, setProblems] = useState<string[]>([]);
  const [refreshing, startTransition] = useTransition();
  const remove = useAction();
  const autoSynced = useRef(false);

  const active = connections.some((c) => c.status === "active");

  async function refresh() {
    if (syncing) return;
    setSyncing(true);
    setProblems([]);
    const res = await api<{ links: SyncLinkReport[] }>("POST", "/api/banking/sync");
    setSyncing(false);
    if (!res.ok) return setProblems([res.error]);
    const links = res.data.links;
    const imported = links.reduce((n, l) => n + (l.status === "ok" ? l.imported : 0), 0);
    if (links.some((l) => l.status === "ok")) toast(s.refreshed(imported));
    setProblems(
      links.flatMap((l) =>
        l.status === "expired"
          ? [s.refreshExpired(l.accountName)]
          : l.status === "failed"
            ? [s.refreshProblem(l.accountName, l.error ?? "")]
            : [],
      ),
    );
    startTransition(() => router.refresh());
  }

  // Back from the bank: say how it went (only the fixed words), clean the address, and fetch at once after a link.
  const flag = params.get("bank");
  const [result] = useState<CallbackResult | null>(() => (isCallbackResult(flag) ? flag : null));
  useEffect(() => {
    if (!isCallbackResult(flag)) return;
    window.history.replaceState(null, "", window.location.pathname);
    if (flag === "linked" && !autoSynced.current) {
      autoSynced.current = true;
      void refresh();
    }
    // refresh is stable enough for a one-time run; listing it would run this again on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flag]);

  async function disconnect(id: number) {
    if (
      await remove.run(() => api("DELETE", `/api/banking/connections/${id}`), {
        success: s.disconnected,
      })
    )
      setConfirming(null);
  }

  if (!configured)
    return (
      <div className="glass grid gap-3 p-4">
        <p className="text-ink-muted max-w-[56ch] text-[15px]">{s.notConfigured}</p>
        <p className="text-ink-muted max-w-[56ch] text-[14px]">{s.promise}</p>
      </div>
    );

  return (
    <div className="glass grid gap-4 p-4">
      <p className="max-w-[56ch] text-[15px]">{s.intro}</p>
      <p className="text-ink-muted max-w-[56ch] text-[14px]">{s.promise}</p>
      {result && (
        <p role="status" className="text-[15px] font-semibold">
          {s.result[result]}
        </p>
      )}
      {connections.length === 0 ? (
        <p className="text-ink-muted text-[15px]">{s.none}</p>
      ) : (
        <ul className="divide-hair -mx-4 divide-y">
          {connections.map((c) => {
            const endsSoon =
              c.status === "active" && c.daysLeft !== null && c.daysLeft <= RECONNECT_DAYS;
            const chip =
              c.status === "active"
                ? endsSoon
                  ? ({ status: "late", label: s.status.endsSoon } as const)
                  : ({ status: "matched", label: s.status.active } as const)
                : ({ status: "missed", label: s.status[c.status] } as const);
            return (
              <li key={c.id} className="grid gap-3 px-4 py-3">
                <div className="grid min-w-0 gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-semibold break-words">{c.bankName}</p>
                    <StatusChip status={chip.status} label={chip.label} />
                  </div>
                  <p className="text-ink-muted text-[14px]">
                    {c.status === "active" && c.daysLeft !== null
                      ? s.daysLeft(c.daysLeft)
                      : s.ended}
                  </p>
                  {c.links.map((l) => (
                    <p key={l.id} className="text-ink-muted text-[14px] break-words">
                      {l.lastSyncedAt
                        ? s.syncedOn(l.accountName, dayLabel(l.lastSyncedAt.slice(0, 10)))
                        : s.neverSynced(l.accountName)}
                    </p>
                  ))}
                </div>
                {confirming === c.id ? (
                  <div className="grid gap-2">
                    <p className="text-[15px]">{s.disconnectQuestion(c.bankName)}</p>
                    <div className="flex flex-wrap gap-2">
                      <SlideOrButton
                        label={t.ui.common.slide.remove}
                        disabled={remove.pending}
                        onConfirm={() => void disconnect(c.id)}
                      >
                        <PrimaryButton
                          type="button"
                          disabled={remove.pending}
                          onClick={() => void disconnect(c.id)}
                        >
                          {s.confirmDisconnect}
                        </PrimaryButton>
                      </SlideOrButton>
                      <GhostButton type="button" onClick={() => setConfirming(null)}>
                        {t.ui.common.cancel}
                      </GhostButton>
                    </div>
                    <ErrorLine message={remove.error} />
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(endsSoon || c.status !== "active") && (
                      <ConnectButton
                        aspsp={{ name: c.bankName, country: COUNTRY }}
                        label={s.reconnect}
                        ariaLabel={s.reconnectLabel(c.bankName)}
                      />
                    )}
                    <GhostButton
                      type="button"
                      aria-label={s.disconnectLabel(c.bankName)}
                      onClick={() => setConfirming(c.id)}
                    >
                      {s.disconnect}
                    </GhostButton>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {problems.length > 0 && (
        <div role="alert" className="grid gap-1">
          {problems.map((p, i) => (
            <ErrorLine key={i} message={p} />
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {active && (
          <PrimaryButton
            type="button"
            disabled={syncing || refreshing}
            onClick={() => void refresh()}
          >
            {syncing ? s.refreshing : s.refresh}
          </PrimaryButton>
        )}
        {!picking && (
          <GhostButton type="button" onClick={() => setPicking(true)}>
            {s.link}
          </GhostButton>
        )}
      </div>
      {picking && <BankPicker onCancel={() => setPicking(false)} />}
    </div>
  );
}

/** Start the link and send the browser to the bank. */
function ConnectButton({
  aspsp,
  label,
  ariaLabel,
}: {
  aspsp: { name: string; country: string };
  label: string;
  ariaLabel?: string;
}) {
  const { t } = useI18n();
  const [going, setGoing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function go() {
    if (going) return;
    setGoing(true);
    setError(null);
    const res = await api<{ url: string }>("POST", "/api/banking/connect", { aspsp });
    if (!res.ok) {
      setGoing(false);
      return setError(res.error);
    }
    // The address comes from our own server, which only passes on an https address from Enable Banking.
    if (!res.data.url.startsWith("https://")) {
      setGoing(false);
      return setError(t.ui.banking.result.failed);
    }
    window.location.assign(res.data.url);
  }

  return (
    <div className="grid gap-1">
      <GhostButton type="button" disabled={going} aria-label={ariaLabel} onClick={() => void go()}>
        {going ? t.ui.banking.opening : label}
      </GhostButton>
      <ErrorLine message={error} />
    </div>
  );
}

/** The Dutch banks Enable Banking can link, as buttons. */
function BankPicker({ onCancel }: { onCancel: () => void }) {
  const { t } = useI18n();
  const s = t.ui.banking;
  const [banks, setBanks] = useState<AspspOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/banking/aspsps?country=${COUNTRY}`);
        const data = (await res.json().catch(() => null)) as
          AspspOption[] | { error?: string } | null;
        if (cancelled) return;
        if (!res.ok || !Array.isArray(data))
          return setError((data as { error?: string } | null)?.error ?? s.result.failed);
        setBanks(data);
      } catch {
        if (!cancelled) setError(s.result.failed);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [s.result.failed]);

  return (
    <section className="border-hair grid gap-3 border-t pt-4" aria-labelledby="bank-picker">
      <h3 id="bank-picker" className="text-ink-muted text-sm font-semibold">
        {s.chooseBank}
      </h3>
      {error ? (
        <ErrorLine message={error} />
      ) : banks === null ? (
        <p className="text-ink-muted text-[15px]">{s.loadingBanks}</p>
      ) : banks.length === 0 ? (
        <p className="text-ink-muted text-[15px]">{s.noBanks}</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {banks.map((b) => (
            <ConnectButton
              key={`${b.country}:${b.name}`}
              aspsp={{ name: b.name, country: b.country }}
              label={b.name}
              ariaLabel={s.linkBankLabel(b.name)}
            />
          ))}
        </div>
      )}
      <div>
        <GhostButton type="button" onClick={onCancel}>
          {t.ui.common.cancel}
        </GhostButton>
      </div>
    </section>
  );
}
