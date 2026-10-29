import type { Messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";
import type { BtwSummary } from "@/lib/btw/summary";
import { formatter } from "@/lib/view/format";

/** The BTW for one quarter: what to set aside, what is in the pocket, and what is still missing. */
export function BtwCard({
  btw,
  client,
  t,
  locale,
}: {
  btw: BtwSummary;
  client: string;
  t: Messages;
  locale: Locale;
}) {
  const b = t.ui.btw;
  const { euro, dayLabel } = formatter(locale);
  const surplus = btw.pocket - btw.owed;
  const sentence = btw.paid
    ? b.sentencePaid(dayLabel(btw.paid.date))
    : btw.toSetAside > 0
      ? b.sentenceMissing(euro(btw.toSetAside), dayLabel(btw.quarter.due))
      : b.sentenceCovered(dayLabel(btw.quarter.due));
  const lines: [string, string, boolean?][] = [
    [b.received(client), euro(btw.received)],
    [b.owed, euro(btw.owed)],
    [b.pocket, euro(btw.pocket)],
    btw.paid
      ? [b.paid, euro(btw.paid.amount)]
      : btw.toSetAside > 0
        ? [b.missing, euro(btw.toSetAside), true]
        : [b.covered, euro(Math.max(surplus, 0))],
  ];
  if (btw.paid && btw.fromOwnMoney > 0) lines.push([b.ownMoney, euro(btw.fromOwnMoney)]);
  if (btw.paid && btw.pocket > 0) lines.push([b.surplus, euro(btw.pocket)]);
  return (
    <div className="glass p-4">
      <p className="text-[15px] font-semibold">{sentence}</p>
      <dl className="mt-3 grid gap-2 text-[15px]">
        {lines.map(([label, value, strong]) => (
          <div key={label} className="flex items-baseline justify-between gap-4">
            <dt className="text-ink-muted">{label}</dt>
            <dd className={`num ${strong ? "font-semibold" : ""}`}>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="text-ink-muted mt-3 text-[13px]">{b.note}</p>
    </div>
  );
}
