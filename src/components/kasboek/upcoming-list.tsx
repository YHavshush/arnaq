import { getI18n } from "@/i18n/server";
import { formatter } from "@/lib/view/format";
import type { UpcomingRow } from "@/lib/view/overzicht";
import { CategoryIcon } from "./category-icon";

/** The next fixed costs to pay. */
export async function UpcomingList({ rows }: { rows: UpcomingRow[] }) {
  const { locale, t } = await getI18n();
  const { euroExact, dayLabel } = formatter(locale);
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
            <span className="bg-accent/12 text-accent mt-1 inline-block rounded-full px-2 py-0.5 text-[12px] font-semibold">
              {t.ui.overview.subDue(dayLabel(r.date))}
            </span>
          </div>
          <div className="num text-right text-base font-semibold tracking-tight">
            {euroExact(r.amount)}
          </div>
        </li>
      ))}
    </ul>
  );
}
