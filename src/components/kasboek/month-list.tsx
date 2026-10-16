import { TrendingDown, TrendingUp } from "lucide-react";
import { getI18n } from "@/i18n/server";
import { formatter } from "@/lib/view/format";
import type { PrognosePoint } from "@/lib/view/prognose";

/** Every month in the forecast as a row: the same numbers as the chart, readable one by one. */
export async function MonthList({ points }: { points: PrognosePoint[] }) {
  const { locale, t } = await getI18n();
  const { euro, euroSigned, monthName } = formatter(locale);
  return (
    <ul className="glass divide-hair divide-y overflow-hidden">
      {points.map((p) => {
        const up = p.net >= 0;
        const Icon = up ? TrendingUp : TrendingDown;
        return (
          <li
            key={p.month}
            className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
          >
            <span
              aria-hidden
              className={`grid size-10 place-content-center rounded-xl ${up ? "bg-good/12 text-good" : "bg-bad/12 text-bad"}`}
            >
              <Icon className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="truncate text-base leading-tight font-semibold">
                {monthName(p.month)}{" "}
                <span className="text-ink-muted text-[13px] font-normal">
                  {t.ui.chart.kindShort[p.kind]}
                </span>
              </div>
              <div className="text-ink-muted num mt-0.5 text-[13px]">
                {t.ui.chart.inOut(euro(p.income), euro(p.expenses))}
              </div>
            </div>
            <div
              className={`num text-right text-base font-semibold tracking-tight ${p.net > 0 ? "text-good" : p.net < 0 ? "text-bad" : ""}`}
            >
              {euroSigned(p.net)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
