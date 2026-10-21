"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { ErrorLine } from "./form";

/** The empty overview's second action: fill the account with sample data to look around. */
export function LoadSampleButton() {
  const router = useRouter();
  const { t } = useI18n();
  const s = t.ui.sample;
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setError(null);
    const res = await api("POST", "/api/sample");
    if (!res.ok) return setError(res.error);
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid justify-items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={load}
        className="glass inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-semibold disabled:opacity-60"
      >
        {busy ? s.loading : s.load}
      </button>
      <p className="text-ink-muted max-w-[44ch] text-[13px]">{s.loadHint}</p>
      <div aria-live="polite">{error && <ErrorLine message={error} />}</div>
    </div>
  );
}

/** Shown on every screen while sample data is in the account, with the one-tap way out. */
export function SampleBanner() {
  const router = useRouter();
  const { t } = useI18n();
  const s = t.ui.sample;
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function useMine() {
    setError(null);
    const res = await api("DELETE", "/api/sample");
    if (!res.ok) return setError(res.error);
    startTransition(() => {
      router.push("/upload");
      router.refresh();
    });
  }

  return (
    <div role="status" className="bg-soft mb-3 grid gap-1 rounded-2xl px-4 py-3 text-[14px]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <span>
          <b className="font-semibold">{s.banner}</b>{" "}
          <span className="text-ink-muted">{s.uploadHint}</span>
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={useMine}
          className="bg-accent text-accent-ink min-h-9 shrink-0 rounded-full px-4 text-[13px] font-semibold disabled:opacity-60"
        >
          {busy ? s.removing : s.useMine}
        </button>
      </div>
      <div aria-live="polite">{error && <ErrorLine message={error} />}</div>
    </div>
  );
}
