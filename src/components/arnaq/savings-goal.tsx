"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { api, euroInputToCents } from "@/lib/client/api";
import { formatter } from "@/lib/view/format";
import { ErrorLine, Field, PrimaryButton, inputClass } from "./form";
import { useToast } from "./toast";

const toInput = (cents: number | null, locale: Locale) =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(".", locale === "nl" ? "," : ".");

/**
 * The savings goal (a total) and what was already saved before the first upload. Progress is that
 * start, plus deposits, minus withdrawals, counted from the Savings category. Once a statement has reported
 * the savings balance, that balance is the start and the field goes away.
 */
export function SavingsGoal({
  goal,
  start,
  anchor,
  anchorDate,
}: {
  goal: number | null;
  start: number;
  /** The savings balance a statement reported, and its day: when there is one, nothing has to be typed. */
  anchor: number | null;
  anchorDate: string | null;
}) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const s = t.ui.settings.savings;
  const [goalText, setGoalText] = useState(toInput(goal, locale));
  const [startText, setStartText] = useState(start === 0 ? "" : toInput(start, locale));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, startTransition] = useTransition();
  const { toast } = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const g = goalText.trim() === "" ? null : euroInputToCents(goalText);
    const fromStatement = anchor !== null && anchorDate !== null;
    const st = startText.trim() === "" ? 0 : euroInputToCents(startText);
    if ((goalText.trim() !== "" && g === null) || (!fromStatement && st === null))
      return setError(s.errAmount);
    const res = await api(
      "PUT",
      "/api/savings/settings",
      fromStatement ? { goal: g } : { goal: g, start: st },
    );
    if (!res.ok) return setError(res.error);
    setSaved(true);
    toast(s.saved);
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
      {anchor !== null && anchorDate !== null ? (
        <p className="text-ink-muted max-w-[56ch] text-[15px]">
          {s.fromStatement(formatter(locale).euro(anchor), formatter(locale).dayLabel(anchorDate))}
        </p>
      ) : (
        <Field label={s.startLabel} hint={s.startHint}>
          <input
            inputMode="decimal"
            value={startText}
            onChange={(e) => setStartText(e.target.value)}
            placeholder="0"
            className={inputClass}
          />
        </Field>
      )}
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
