"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { api, euroInputToCents } from "@/lib/client/api";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, GhostButton, inputClass } from "./form";
import { useAction } from "./use-action";

interface Line {
  categoryId: number;
  name: string;
  /** What the person typed on top of the fixed items (cents), or null when nothing. */
  budget: number | null;
  /** The fixed items in this category (rent, insurance, subscriptions...): already a budget, cents. */
  fixed: number;
}

const toInput = (cents: number | null, locale: Locale) =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(".", locale === "nl" ? "," : ".");

/**
 * One input per category plus an optional total. A field saves when you leave it; an empty field
 * removes that budget. "Copy previous month" fills the month from the one before.
 */
export function BudgetEditor({
  month,
  prevMonth,
  lines,
  total,
  prevLabel,
  savings = null,
}: {
  month: string;
  prevMonth: string;
  lines: Line[];
  total: number | null;
  prevLabel: string;
  /** The savings total and its goal: one total, edited like a budget. */
  savings?: { saved: number; goal: number | null } | null;
}) {
  const { locale, t } = useI18n();
  const { run, pending: busy, error: apiError } = useAction();
  const [fieldError, setFieldError] = useState<{ key: string; message: string } | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const failed = (key: string) => (fieldError?.key === key ? fieldError.message : null);

  async function save(
    key: string,
    raw: string,
    before: number | null,
    call: (cents: number | null) => ReturnType<typeof api>,
  ) {
    const trimmed = raw.trim();
    const cents = trimmed === "" ? null : euroInputToCents(trimmed);
    if (trimmed !== "" && cents === null)
      return setFieldError({ key, message: t.ui.budget.errAmount });
    if (cents === before) return;
    setFieldError(null);
    if (await run(() => call(cents), { success: t.ui.budget.saved })) {
      setSavedKey(key);
      window.setTimeout(() => setSavedKey((k) => (k === key ? null : k)), 2200);
    }
  }

  function copy() {
    return run(() => api("POST", "/api/budgets/copy", { from: prevMonth, to: month }), {
      success: (data) => {
        const n = (data as { copied?: number } | null)?.copied ?? 0;
        return n > 0 ? t.ui.budget.copied(n) : t.ui.budget.copyNothing;
      },
    });
  }

  return (
    <div className="grid gap-4">
      <div className="glass grid gap-3 p-4">
        <label className="grid gap-1.5 text-sm font-medium">
          {t.ui.budget.total}
          <input
            inputMode="decimal"
            defaultValue={toInput(total, locale)}
            key={`total-${total}`}
            placeholder={t.ui.budget.totalPlaceholder}
            aria-invalid={failed("total") ? true : undefined}
            className={inputClass}
            onBlur={(e) =>
              save("total", e.target.value, total, (amount) =>
                api("PUT", "/api/budgets/total", { month, amount }),
              )
            }
          />
          <ErrorLine message={failed("total")} />
        </label>
        <div>
          <GhostButton type="button" disabled={busy} onClick={copy}>
            {t.ui.budget.copy(prevLabel)}
          </GhostButton>
        </div>
      </div>

      {savings && (
        <div className="glass grid gap-3 p-4">
          <div className="flex items-baseline justify-between gap-3">
            <b className="text-base">{t.ui.budget.savings.title}</b>
            {savedKey === "savings" && (
              <span className="text-good text-[13px] font-semibold">✓ {t.ui.budget.saved}</span>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] items-end gap-3">
            <div>
              <div className="num text-[26px] leading-none font-semibold">
                {formatter(locale).euroExact(savings.saved)}
              </div>
              <div className="text-ink-muted mt-1 text-[13px]">{t.ui.budget.savings.saved}</div>
            </div>
            <label className="grid gap-1 text-right text-[13px]">
              <span className="text-ink-muted">{t.ui.budget.savings.goal}</span>
              <input
                inputMode="decimal"
                defaultValue={toInput(savings.goal, locale)}
                key={`goal-${savings.goal}`}
                placeholder="€"
                aria-label={t.ui.budget.savings.goal}
                className={`${inputClass} num text-right`}
                onBlur={(e) =>
                  save("savings", e.target.value, savings.goal, (goal) =>
                    api("PUT", "/api/savings/settings", { goal }),
                  )
                }
              />
            </label>
          </div>
          {savings.goal !== null && savings.goal > 0 ? (
            <>
              <div aria-hidden className="bg-track h-2 overflow-hidden rounded-full">
                <i
                  className="bg-accent block h-full rounded-full transition-[width] duration-500"
                  style={{
                    width: `${Math.min(Math.max(savings.saved / savings.goal, 0), 1) * 100}%`,
                  }}
                />
              </div>
              <p className="text-ink-muted text-[13px]">
                {savings.saved >= savings.goal
                  ? t.ui.budget.savings.reached
                  : t.ui.budget.savings.progress(
                      Math.round((Math.max(savings.saved, 0) / savings.goal) * 100),
                      formatter(locale).euro(savings.goal - savings.saved),
                    )}
              </p>
            </>
          ) : (
            <p className="text-ink-muted text-[13px]">{t.ui.budget.savings.none}</p>
          )}
        </div>
      )}

      <div className="glass overflow-hidden">
        <ul className="divide-hair divide-y">
          {lines.map((l) => (
            <li
              key={l.categoryId}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_7.5rem] items-center gap-3 px-4 py-2.5"
            >
              <CategoryIcon name={l.name} />
              <label htmlFor={`b-${l.categoryId}`} className="min-w-0 truncate font-semibold">
                {categoryLabel(l.name, locale)}
                {failed(`c${l.categoryId}`) && (
                  <span role="alert" className="text-bad block text-[13px] font-medium">
                    {failed(`c${l.categoryId}`)}
                  </span>
                )}
                {l.fixed > 0 && (
                  <span className="text-ink-muted block text-[13px] font-normal">
                    {t.ui.budget.fixedPart(formatter(locale).euroExact(l.fixed))}
                  </span>
                )}
                {savedKey === `c${l.categoryId}` && (
                  <span className="text-good ml-2 text-[13px] font-medium">
                    {t.ui.budget.saved}
                  </span>
                )}
              </label>
              <input
                id={`b-${l.categoryId}`}
                inputMode="decimal"
                defaultValue={toInput(l.budget, locale)}
                key={`${l.categoryId}-${l.budget}`}
                placeholder={l.fixed > 0 ? t.ui.budget.extraPlaceholder : "€"}
                aria-label={t.ui.budget.forCategory(categoryLabel(l.name, locale))}
                aria-invalid={failed(`c${l.categoryId}`) ? true : undefined}
                className={`${inputClass} num text-right`}
                onBlur={(e) =>
                  save(`c${l.categoryId}`, e.target.value, l.budget, (amount) =>
                    api("PUT", "/api/budgets", { month, categoryId: l.categoryId, amount }),
                  )
                }
              />
            </li>
          ))}
        </ul>
      </div>
      <ErrorLine message={apiError} />
    </div>
  );
}
