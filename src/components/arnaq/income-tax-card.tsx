import type { Messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";
import { formatRatePercent } from "@/lib/income-tax/rate";
import type { IncomeTaxYearSummary } from "@/lib/income-tax/summary";
import { formatter } from "@/lib/view/format";

/**
 * The income tax for one tax year (the BtwCard's sibling). Estimate mode: what should be set aside by now of what the
 * year is expected to come to. Known mode: the amount on the aanslag, less what was paid for it. Both show the pocket,
 * the part of the savings counted as income tax money (`pot`, "My income tax pot is part of my savings", see taxPots),
 * and what is still missing. `children` is where the payments to pick go (IncomeTaxPayments).
 */
export function IncomeTaxCard({
  year: y,
  pot = 0,
  t,
  locale,
  children,
}: {
  year: IncomeTaxYearSummary;
  pot?: number;
  t: Messages;
  locale: Locale;
  children?: React.ReactNode;
}) {
  const s = t.ui.incomeTax;
  const { euro } = formatter(locale);
  // The pot only fills the gap the pocket leaves (potByYear never gives a year more than its toSetAside).
  const fromSavings = Math.min(Math.max(pot, 0), y.toSetAside);
  const covered = y.pocket + fromSavings;
  const missing = y.toSetAside - fromSavings;
  const known = y.mode === "known";
  const headline = known
    ? s.bill(euro(y.expected), y.year)
    : s.soFarOf(euro(y.soFar), euro(y.expected), y.year);
  const sentence = known
    ? missing > 0
      ? s.sentenceBillMissing(euro(missing))
      : s.sentenceBillCovered
    : missing > 0
      ? s.sentenceMissing(euro(missing))
      : s.sentenceCovered;
  const fill = y.owed > 0 ? Math.min(Math.max(covered, 0) / y.owed, 1) : 1;
  const lines: [string, string][] = [];
  if (!known) lines.push([s.rate(formatRatePercent(y.rate, locale)), euro(y.soFar)]);
  lines.push([s.pocket, euro(y.pocket)]);
  if (fromSavings > 0) lines.push([s.fromSavings, euro(fromSavings)]);
  if (y.paid > 0) lines.push([s.paid, euro(y.paid)]);
  if (known) lines.push([s.toPay, euro(y.owed)]);
  if (missing > 0) lines.push([s.missing, euro(missing)]);
  return (
    <div className="glass p-4">
      <p className="num text-[15px] font-semibold">{headline}</p>
      <p className="text-ink-muted mt-1 text-[15px]">{sentence}</p>
      <div aria-hidden className="bg-track mt-2 h-1.5 overflow-hidden rounded-full">
        <i className="bg-accent block h-full rounded-full" style={{ width: `${fill * 100}%` }} />
      </div>
      <dl className="mt-2 grid gap-1 text-[14px]">
        {lines.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-muted">{label}</dt>
            <dd className="num">{value}</dd>
          </div>
        ))}
      </dl>
      {children}
    </div>
  );
}
