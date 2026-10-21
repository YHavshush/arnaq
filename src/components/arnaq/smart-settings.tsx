"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { ErrorLine, PrimaryButton } from "./form";

interface Props {
  provider: "off" | "claude" | "chatgpt";
  /** May this person use arnaq AI (arnaq plus)? */
  entitled: boolean;
  /** Is a provider built for it yet? */
  available: boolean;
}

const row =
  "grid grid-cols-[1.25rem_minmax(0,1fr)] items-start gap-3 px-4 py-3 text-left disabled:opacity-60";

/** Where smart sorting gets its help from: nothing (default), arnaq AI after consent, or later the person's ChatGPT plan. */
export function SmartSettings({ provider, entitled, available }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const s = t.ui.settings.smart;
  const [busy, startTransition] = useTransition();
  const [asking, setAsking] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function save(next: "off" | "claude") {
    setError(null);
    const res = await api("PUT", "/api/smart/settings", { provider: next, consent: agreed });
    if (!res.ok) return setError(res.error);
    setAsking(false);
    setAgreed(false);
    setNote(next === "claude" ? s.switchedOn : s.saved);
    startTransition(() => router.refresh());
  }

  const claudeBlocked = !entitled || !available;
  const dot = (on: boolean) => (
    <span
      aria-hidden
      className={`mt-1 size-3.5 rounded-full border-2 ${on ? "border-accent bg-accent" : "border-ink-muted"}`}
    />
  );

  return (
    <div className="glass overflow-hidden">
      <p className="text-ink-muted border-hair border-b px-4 py-3 text-[14px]">{s.intro}</p>
      <ul className="divide-hair divide-y" role="radiogroup" aria-label={s.title}>
        <li>
          <button
            type="button"
            role="radio"
            aria-checked={provider === "off"}
            disabled={busy}
            onClick={() => (provider === "off" ? setAsking(false) : save("off"))}
            className={row + " w-full"}
          >
            {dot(provider === "off")}
            <span>
              <span className="block font-semibold">{s.off}</span>
              <span className="text-ink-muted block text-[13px]">{s.offHint}</span>
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            role="radio"
            aria-checked={provider === "claude"}
            disabled={busy || claudeBlocked}
            onClick={() => provider !== "claude" && setAsking(true)}
            className={row + " w-full"}
          >
            {dot(provider === "claude")}
            <span>
              <span className="block font-semibold">{s.claude}</span>
              <span className="text-ink-muted block text-[13px]">
                {!entitled ? s.needsPlus : !available ? s.notAvailable : s.claudeHint}
              </span>
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            role="radio"
            aria-checked="false"
            disabled
            className={row + " w-full"}
          >
            {dot(false)}
            <span>
              <span className="block font-semibold">{s.chatgpt}</span>
              <span className="text-ink-muted block text-[13px]">{s.chatgptHint}</span>
            </span>
          </button>
        </li>
      </ul>

      {asking && !claudeBlocked && (
        <div className="border-hair grid gap-3 border-t px-4 py-4">
          <h3 className="font-display text-xl font-medium">{s.consentTitle}</h3>
          <p className="text-[15px]">{s.consentSends}</p>
          <p className="text-[15px]">{s.consentNever}</p>
          <p className="text-[15px]">{s.consentWho}</p>
          <label className="flex min-h-11 items-center gap-3 text-[15px] font-semibold">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="size-5"
            />
            {s.consentAgree}
          </label>
          <div>
            <PrimaryButton type="button" disabled={!agreed || busy} onClick={() => save("claude")}>
              {s.switchOn}
            </PrimaryButton>
          </div>
        </div>
      )}
      <div className="px-4 pb-3" aria-live="polite">
        {error ? (
          <ErrorLine message={error} />
        ) : note ? (
          <span className="text-ink-muted text-[13px]">{note}</span>
        ) : null}
      </div>
    </div>
  );
}
