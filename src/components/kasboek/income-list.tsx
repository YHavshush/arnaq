import { getI18n } from "@/i18n/server";
import { formatter } from "@/lib/view/format";
import type { IncomeRow } from "@/lib/view/overzicht";
import { CategoryIcon } from "./category-icon";

/** Money in this month: what has arrived and what is still expected. */
export async function IncomeList({ rows }: { rows: IncomeRow[] }) {
  const { locale, t } = await getI18n();
  const { euro, dayLabel } = formatter(locale);
  const o = t.ui.overview;
  return (
    <ul className="glass divide-hair divide-y overflow-hidden">
      {rows.map((r) => (
        <li
          key={r.key}
          className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
        >
          <CategoryIcon name={r.category} />
          <div className="min-w-0">
            <div className="truncate text-base leading-tight font-semibold">{r.name}</div>
            <div className="text-ink-muted mt-0.5 text-[13px]">
              {r.date === null
                ? ""
                : r.status === "received"
                  ? o.incomeReceived(dayLabel(r.date))
                  : o.incomeExpected(dayLabel(r.date))}
            </div>
          </div>
          <div className="num flex items-center gap-2 text-right text-base font-semibold tracking-tight">
            {r.status === "missing" ? (
              <span className="bg-bad/12 text-bad rounded-full px-2 py-0.5 text-[12px] font-semibold">
                {o.incomeMissing}
              </span>
            ) : (
              euro(r.amount)
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
