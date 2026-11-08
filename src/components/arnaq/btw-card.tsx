import type { Messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";
import type { BtwSummary } from "@/lib/btw/summary";
import { formatter } from "@/lib/view/format";

/** The BTW for one quarter: what to set aside, what is in the pocket, and what is still missing. */
export function BtwCard({ btw, t, locale }: { btw: BtwSummary; t: Messages; locale: Locale }) {
  const b = t.ui.btw;
  const { euro, dayLabel } = formatter(locale);
  const surplus = btw.pocket - btw.owed;
  // Until the quarter's receipt window has ended, more money for it can arrive: say it is what is known so far.
  const soFar = !btw.paid && !btw.complete;
  const until = dayLabel(btw.receipts.to);
  const due = dayLabel(btw.quarter.due);
  const sentence = btw.paid
    ? b.sentencePaid(dayLabel(btw.paid.date))
    : btw.toSetAside > 0
      ? soFar
        ? b.sentenceMissingSoFar(euro(btw.toSetAside), until, due)
        : b.sentenceMissing(euro(btw.toSetAside), due)
      : soFar
        ? b.sentenceCoveredSoFar(until, due)
        : b.sentenceCovered(due);
  const fill = btw.paid ? 1 : btw.owed > 0 ? Math.min(Math.max(btw.pocket, 0) / btw.owed, 1) : 0;
  const lines: [string, string][] = [];
  if (btw.paid) lines.push([b.paid, euro(btw.paid.amount)]);
  if (btw.paid && btw.fromOwnMoney > 0) lines.push([b.ownMoney, euro(btw.fromOwnMoney)]);
  if (btw.paid && btw.pocket > 0) lines.push([b.surplus, euro(btw.pocket)]);
  if (!btw.paid && surplus > 0) lines.push([b.surplus, euro(surplus)]);
  return (
    <div className="glass p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-[15px] font-semibold">{sentence}</p>
        <p className="num text-[15px]">
          {btw.paid
            ? b.paidAmount(euro(btw.paid.amount))
            : soFar
              ? b.pocketOfSoFar(euro(btw.pocket), euro(btw.owed))
              : b.pocketOf(euro(btw.pocket), euro(btw.owed))}
        </p>
      </div>
      <div aria-hidden className="bg-track mt-2 h-1.5 overflow-hidden rounded-full">
        <i className="bg-accent block h-full rounded-full" style={{ width: `${fill * 100}%` }} />
      </div>
      {lines.length > 0 && (
        <dl className="mt-2 grid gap-1 text-[14px]">
          {lines.map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-4">
              <dt className="text-ink-muted">{label}</dt>
              <dd className="num">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
