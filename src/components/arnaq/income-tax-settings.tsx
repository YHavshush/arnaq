"use client";

import { useId, useState } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import {
  DEFAULT_INCOME_TAX_POCKET_MATCH as DEFAULT_POCKET,
  MAX_INCOME_TAX_YEARS as MAX_YEARS,
  formatRatePercent,
  parseRatePercent,
} from "@/lib/income-tax/rate";
import type { IncomeTaxYear } from "@/lib/income-tax/years";
import { amountToInput, parseAmountInput } from "@/lib/view/plan-grid";
import { formatter } from "@/lib/view/format";
import { ErrorLine, Field, GhostButton, PrimaryButton, inputClass } from "./form";
import { SlideOrButton } from "./slide-to-confirm";
import { useAction } from "./use-action";

/**
 * The person's tax years: the rate the adviser gave, and the amount on the aanslag once it is in. Add, edit and remove;
 * removing asks first (a slide on a touch screen, a second button elsewhere), as with the BTW clients.
 */
export function IncomeTaxYears({ years, thisYear }: { years: IncomeTaxYear[]; thisYear: number }) {
  const { t, locale } = useI18n();
  const s = t.ui.incomeTax.settings;
  const { euro } = formatter(locale);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const { run, pending, error } = useAction();

  async function remove(id: number) {
    if (await run(() => api("DELETE", `/api/income-tax/years/${id}`), { success: s.yearRemoved }))
      setConfirming(null);
  }

  return (
    <div className="glass grid gap-4 p-4">
      <p className="text-ink-muted max-w-[56ch] text-[15px]">{s.intro}</p>
      {years.length === 0 ? (
        <p className="text-ink-muted text-[15px]">{s.noYears}</p>
      ) : (
        <ul className="divide-hair -mx-4 divide-y">
          {years.map((y) => (
            <li key={y.id} className="grid gap-3 px-4 py-3">
              {editing === y.id ? (
                <YearForm year={y} thisYear={thisYear} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <div className="min-w-0">
                    <p className="num font-semibold">{y.year}</p>
                    <p className="text-ink-muted text-[14px]">
                      {s.rateSummary(formatRatePercent(y.rate, locale))}
                    </p>
                    <p className="text-ink-muted text-[14px]">
                      {y.knownAmount === null
                        ? s.estimateSummary
                        : s.knownSummary(euro(y.knownAmount))}
                    </p>
                  </div>
                  {confirming === y.id ? (
                    <div className="grid gap-2">
                      <p className="text-[15px]">{s.removeQuestion(y.year)}</p>
                      <div className="flex flex-wrap gap-2">
                        <SlideOrButton
                          label={t.ui.common.slide.remove}
                          disabled={pending}
                          onConfirm={() => void remove(y.id)}
                        >
                          <PrimaryButton
                            type="button"
                            disabled={pending}
                            onClick={() => void remove(y.id)}
                          >
                            {s.confirmRemoveYear}
                          </PrimaryButton>
                        </SlideOrButton>
                        <GhostButton type="button" onClick={() => setConfirming(null)}>
                          {t.ui.common.cancel}
                        </GhostButton>
                      </div>
                      <ErrorLine message={error} />
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <GhostButton
                        type="button"
                        disabled={pending}
                        aria-label={s.editYearLabel(y.year)}
                        onClick={() => {
                          setConfirming(null);
                          setAdding(false);
                          setEditing(y.id);
                        }}
                      >
                        {s.editYear}
                      </GhostButton>
                      <GhostButton
                        type="button"
                        disabled={pending}
                        aria-label={s.removeYearLabel(y.year)}
                        onClick={() => {
                          setEditing(null);
                          setConfirming(y.id);
                        }}
                      >
                        {s.removeYear}
                      </GhostButton>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="border-hair grid gap-3 border-t pt-4">
          <YearForm thisYear={thisYear} onDone={() => setAdding(false)} />
        </div>
      ) : years.length >= MAX_YEARS ? (
        <p className="text-ink-muted text-[14px]">{s.yearLimit(MAX_YEARS)}</p>
      ) : (
        <div>
          <GhostButton
            type="button"
            onClick={() => {
              setEditing(null);
              setConfirming(null);
              setAdding(true);
            }}
          >
            {s.addYear}
          </GhostButton>
        </div>
      )}
      <p className="text-ink-muted max-w-[56ch] text-[14px]">{s.rule}</p>
    </div>
  );
}

/** Add a tax year (no `year`) or edit one: the year, the rate in percent, and the amount on the aanslag if known. */
function YearForm({
  year,
  thisYear,
  onDone,
}: {
  year?: IncomeTaxYear;
  thisYear: number;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const s = t.ui.incomeTax.settings;
  const [taxYear, setTaxYear] = useState(String(year?.year ?? thisYear));
  const [rate, setRate] = useState(year ? formatRatePercent(year.rate, locale) : "");
  const [known, setKnown] = useState(
    year?.knownAmount == null ? "" : amountToInput(year.knownAmount, locale),
  );
  const { run, pending, error, setError } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bp = parseRatePercent(rate);
    if (bp === null) return setError(s.badRate);
    const amount = known.trim() === "" ? null : parseAmountInput(known);
    if (amount !== null && !amount.ok) return setError(s.badAmount);
    const body = {
      year: Number(taxYear),
      rate: bp,
      knownAmount: amount === null ? null : amount.cents,
    };
    const saved = await run(
      () =>
        year
          ? api("PATCH", `/api/income-tax/years/${year.id}`, body)
          : api("POST", "/api/income-tax/years", body),
      { success: year ? s.yearSaved : s.yearAdded },
    );
    if (saved) onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={s.yearLabel}>
        <input
          value={taxYear}
          onChange={(e) => setTaxYear(e.target.value.replace(/\D/g, "").slice(0, 4))}
          inputMode="numeric"
          required
          autoComplete="off"
          className={inputClass}
        />
      </Field>
      <Field label={s.rateLabel} hint={s.rateHint}>
        <input
          value={rate}
          onChange={(e) => setRate(e.target.value)}
          inputMode="decimal"
          required
          autoComplete="off"
          className={inputClass}
        />
      </Field>
      <Field label={s.knownLabel} hint={s.knownHint}>
        <input
          value={known}
          onChange={(e) => setKnown(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          className={inputClass}
        />
      </Field>
      <ErrorLine message={error} />
      <div className="flex flex-wrap gap-2">
        <PrimaryButton type="submit" disabled={pending}>
          {s.saveYear}
        </PrimaryButton>
        <GhostButton type="button" onClick={onDone}>
          {t.ui.common.cancel}
        </GhostButton>
      </div>
    </form>
  );
}

/** On or off, the word that marks a move to savings as income tax money, and whether the pot is part of the savings. */
export function IncomeTaxSettings({
  on,
  pocket,
  potInSavings,
}: {
  on: boolean;
  pocket: string;
  potInSavings: boolean;
}) {
  const { t } = useI18n();
  const s = t.ui.incomeTax.settings;
  const [isOn, setOn] = useState(on);
  const [pocketText, setPocketText] = useState(pocket);
  const [pot, setPot] = useState(potInSavings);
  const onHint = useId();
  const potHint = useId();
  const { run, pending, error } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(
      () =>
        api("PUT", "/api/income-tax/settings", {
          on: isOn,
          pocket: pocketText,
          potInSavings: pot,
        }),
      { success: s.saved },
    );
  }

  return (
    <form onSubmit={submit} className="glass grid gap-4 p-4">
      <div className="grid gap-1.5">
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={isOn}
            onChange={(e) => setOn(e.target.checked)}
            aria-describedby={onHint}
            className="size-5"
          />
          {s.onLabel}
        </label>
        <span id={onHint} className="text-ink-muted text-[13px]">
          {s.onHint}
        </span>
      </div>
      <Field label={s.pocketLabel} hint={s.pocketHint}>
        <input
          value={pocketText}
          onChange={(e) => setPocketText(e.target.value)}
          placeholder={DEFAULT_POCKET}
          maxLength={60}
          className={inputClass}
        />
      </Field>
      <div className="grid gap-1.5">
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={pot}
            onChange={(e) => setPot(e.target.checked)}
            aria-describedby={potHint}
            className="size-5"
          />
          {s.potLabel}
        </label>
        <span id={potHint} className="text-ink-muted text-[13px]">
          {s.potHint}
        </span>
      </div>
      <ErrorLine message={error} />
      <div>
        <PrimaryButton type="submit" disabled={pending}>
          {s.save}
        </PrimaryButton>
      </div>
    </form>
  );
}
