"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { api, euroInputToCents } from "@/lib/client/api";
import { ErrorLine, PrimaryButton, inputClass } from "./form";
import { useAction } from "./use-action";

const toInput = (cents: number | null, locale: Locale) =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(".", locale === "nl" ? "," : ".");

/** "My own" basis of the forecast: one number for what is spent each month on everyday things. */
export function OwnSpendingForm({ amount }: { amount: number | null }) {
  const { locale, t } = useI18n();
  const o = t.ui.forecast.own;
  const [text, setText] = useState(toInput(amount, locale));
  const [formError, setFormError] = useState<string | null>(null);
  const { run, pending, error: apiError } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const cents = text.trim() === "" ? null : euroInputToCents(text);
    if (text.trim() !== "" && cents === null) return setFormError(o.errAmount);
    await run(() => api("PUT", "/api/forecast/own", { amount: cents }), { success: o.saved });
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3 px-2 pb-3">
      <label className="grid gap-1 text-[13px]">
        <span className="text-ink-muted">{o.label}</span>
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={o.placeholder}
          className={`${inputClass} w-40`}
        />
      </label>
      <PrimaryButton type="submit" disabled={pending}>
        {o.save}
      </PrimaryButton>
      <ErrorLine message={formError ?? apiError} />
    </form>
  );
}
