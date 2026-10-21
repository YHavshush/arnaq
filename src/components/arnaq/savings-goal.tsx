"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { api, euroInputToCents } from "@/lib/client/api";
import { ErrorLine, Field, PrimaryButton, inputClass } from "./form";

const toInput = (cents: number | null, locale: Locale) =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(".", locale === "nl" ? "," : ".");

/**
 * The savings goal (a total) and what was already saved before the first upload. Progress is that
 * start, plus deposits, minus withdrawals, counted from the Savings category.
 */
export function SavingsGoal({ goal, start }: { goal: number | null; start: number }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const s = t.ui.settings.savings;
  const [goalText, setGoalText] = useState(toInput(goal, locale));
  const [startText, setStartText] = useState(start === 0 ? "" : toInput(start, locale));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, startTransition] = useTransition();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const g = goalText.trim() === "" ? null : euroInputToCents(goalText);
    const st = startText.trim() === "" ? 0 : euroInputToCents(startText);
    if ((goalText.trim() !== "" && g === null) || st === null) return setError(s.errAmount);
    const res = await api("PUT", "/api/savings/settings", { goal: g, start: st });
    if (!res.ok) return setError(res.error);
    setSaved(true);
    startTransition(() => router.refresh());
  }

  return (
    <form onSubmit={submit} className="glass grid gap-4 p-4">
      <p className="text-ink-muted max-w-[56ch] text-[15px]">{s.intro}</p>
      <Field label={s.goalLabel} hint={s.goalHint}>
        <input
          inputMode="decimal"
          value={goalText}
          onChange={(e) => setGoalText(e.target.value)}
          placeholder={s.goalPlaceholder}
          className={inputClass}
        />
      </Field>
      <Field label={s.startLabel} hint={s.startHint}>
        <input
          inputMode="decimal"
          value={startText}
          onChange={(e) => setStartText(e.target.value)}
          placeholder="0"
          className={inputClass}
        />
      </Field>
      <ErrorLine message={error} />
      <div className="flex flex-wrap items-center gap-3">
        <PrimaryButton type="submit" disabled={busy}>
          {s.save}
        </PrimaryButton>
        <span className="text-ink-muted text-[14px]" aria-live="polite">
          {saved ? s.saved : ""}
        </span>
      </div>
    </form>
  );
}
