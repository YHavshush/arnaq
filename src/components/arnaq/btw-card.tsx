import type { Locale } from "@/i18n/config";
import type { Messages } from "@/i18n/messages";
import type { BtwSummary } from "@/lib/btw/summary";
import { formatter } from "@/lib/view/format";

/** The BTW of the current quarter in one line: what is still to set aside and by when, or what was paid. */
export function BtwChip({ btw, t, locale }: { btw: BtwSummary; t: Messages; locale: Locale }) {
  const b = t.ui.btw;
  const { euro, dayLabel } = formatter(locale);
  const quarter = btw.quarter.label.replace("-", " ");
  const text = btw.paid
    ? b.chipPaid(quarter, euro(btw.paid.amount), dayLabel(btw.paid.date))
    : btw.toSetAside > 0
      ? b.chipMissing(quarter, euro(btw.toSetAside), dayLabel(btw.quarter.due))
      : b.chipCovered(quarter, dayLabel(btw.quarter.due));
  const warn = !btw.paid && btw.toSetAside > 0;
  return (
    <p className="bg-soft inline-flex items-center gap-2.5 rounded-full px-4 py-2 text-[13px] leading-snug">
      <i
        aria-hidden
        className={`block size-2.5 shrink-0 rounded-full ${warn ? "bg-warn" : "bg-good"}`}
      />
      <span>{text}</span>
    </p>
  );
}
