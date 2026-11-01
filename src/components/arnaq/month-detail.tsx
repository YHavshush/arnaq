"use client";

import { useId, useState } from "react";
import { useI18n } from "@/i18n/client";
import { formatter } from "@/lib/view/format";
import type { MonthParts } from "@/lib/view/month-parts";
import type { PrognosePoint } from "@/lib/view/prognose";

type Open = "income" | "expenses" | null;

/**
 * The three numbers of one month (income, expenses, growth). Tapping Income or Expenses opens the parts
 * underneath, one at a time; tapping it again closes it.
 */
export function MonthDetail({ point }: { point: PrognosePoint }) {
  const { locale, t } = useI18n();
  const { euro, euroSigned } = formatter(locale);
  const [open, setOpen] = useState<Open>(null);
  const panel = useId();
  const tile = (which: Exclude<Open, null>, label: string, value: string) => (
    <button
      type="button"
      aria-expanded={open === which}
      aria-controls={panel}
      onClick={() => setOpen(open === which ? null : which)}
      className={`bg-soft focus-visible:ring-accent grid min-h-14 cursor-pointer content-center justify-items-center gap-0.5 rounded-2xl px-2 py-2 outline-none focus-visible:ring-2 ${open === which ? "ring-accent/60 ring-2" : ""}`}
    >
      <span className="text-ink-muted text-xs">{label}</span>
      <span className="text-base font-semibold tracking-tight">{value}</span>
    </button>
  );
  const growthColour = point.net > 0 ? "text-good" : point.net < 0 ? "text-bad" : "";

  return (
    <div className="grid gap-3">
      <div className="num grid grid-cols-3 gap-2 text-center">
        {tile(
          "income",
          point.kind === "mixed" || point.kind === "forecast"
            ? t.ui.chart.expectedIncome
            : t.ui.chart.income,
          euro(point.income),
        )}
        {tile(
          "expenses",
          point.kind === "mixed" || point.kind === "forecast"
            ? t.ui.chart.expectedExpenses
            : t.ui.chart.expenses,
          euro(point.expenses),
        )}
        <div className="bg-soft grid min-h-14 content-center justify-items-center gap-0.5 rounded-2xl px-2 py-2">
          <span className="text-ink-muted text-xs">{t.ui.chart.growth}</span>
          <span className={`text-base font-semibold tracking-tight ${growthColour}`}>
            {euroSigned(point.net)}
          </span>
        </div>
      </div>
      <div id={panel}>
        {open && (
          <PartsList
            key={open}
            title={open === "income" ? t.ui.chart.income : t.ui.chart.expenses}
            count={
              open === "income"
                ? t.ui.chart.parts.incomeCount(point.incomeParts.lines.length)
                : t.ui.chart.parts.expenseCount(point.expenseParts.lines.length)
            }
            empty={open === "income" ? t.ui.chart.parts.noIncome : t.ui.chart.parts.noExpenses}
            parts={open === "income" ? point.incomeParts : point.expenseParts}
          />
        )}
      </div>
    </div>
  );
}

function PartsList({
  title,
  count,
  empty,
  parts,
}: {
  title: string;
  count: string;
  empty: string;
  parts: MonthParts;
}) {
  const { locale, t } = useI18n();
  const { euro } = formatter(locale);
  return (
    <section aria-label={title} className="bg-soft rounded-2xl px-4 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="font-semibold">{title}</h4>
        <span className="text-ink-muted text-[13px]">{count}</span>
      </div>
      {parts.lines.length === 0 ? (
        <p className="text-ink-muted mt-2 text-[15px]">{empty}</p>
      ) : (
        <ul className="divide-hair divide-y">
          {parts.lines.map((line) => (
            <li key={line.key} className="grid gap-1 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0">
                  <span
                    aria-hidden
                    className="mr-2 inline-block size-2.5 rounded-full align-middle"
                    style={{ background: `var(--chart-${line.tone})` }}
                  />
                  {line.label}
                  {line.count && (
                    <span className="text-ink-muted ml-1.5 text-[13px]">{line.count}</span>
                  )}
                </span>
                <span className="num font-semibold">{euro(line.amount)}</span>
              </div>
              <div aria-hidden className="bg-track h-[7px] overflow-hidden rounded-full">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.round(line.share * 100)}%`,
                    background: `var(--chart-${line.tone})`,
                  }}
                />
              </div>
              <div className="text-ink-muted flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0">{line.sub}</span>
                {line.tag && <span className="shrink-0">{line.tag}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="border-ink mt-1 flex items-baseline justify-between gap-3 border-t pt-2 font-semibold">
        <span>{t.ui.chart.parts.total}</span>
        <span className="num">{euro(parts.total)}</span>
      </div>
      {parts.note && <p className="text-ink-muted mt-2 text-[13px]">{parts.note}</p>}
    </section>
  );
}
