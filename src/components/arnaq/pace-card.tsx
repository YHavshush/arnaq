import { getI18n } from "@/i18n/server";
import { formatter } from "@/lib/view/format";
import type { PaceCard as Pace } from "@/lib/view/overzicht";

const CHIP: Record<Pace["tone"], string> = {
  good: "bg-good/12 text-good",
  accent: "bg-soft text-ink",
  warn: "bg-warn/14 text-warn",
  bad: "bg-bad/12 text-bad",
};

/**
 * The pace of everyday spending: how much is spent against an even pace through the month, and one
 * bar per day. Days at or above the threshold are drawn dark and numbered.
 */
export async function PaceCard({ pace, month }: { pace: Pace; month: string }) {
  const { locale, t } = await getI18n();
  const { euro, dayLabel, plain } = formatter(locale);
  const o = t.ui.overview;
  const max = Math.max(pace.threshold, ...pace.days.map((d) => d.amount));
  const last = pace.days.length;
  const high = pace.days.filter((d) => d.amount >= pace.threshold).length;
  const fill = pace.budget ? Math.min(pace.spent / pace.budget, 1) : 0;
  const tick = pace.budget ? Math.min(pace.progress, 1) : null;

  return (
    <div className="glass p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="num text-[26px] leading-none font-semibold tracking-tight">
          {euro(pace.spent)}
          {pace.budget !== null && (
            <span className="text-ink-muted ml-1.5 text-[15px] font-normal">
              {o.paceOf(euro(pace.budget))}
            </span>
          )}
        </div>
        {pace.ahead !== null && (
          <span
            className={`num rounded-full px-2.5 py-1 text-[13px] font-semibold ${CHIP[pace.tone]}`}
          >
            {pace.ahead >= 0 ? o.paceAhead(euro(pace.ahead)) : o.paceBehind(euro(-pace.ahead))}
          </span>
        )}
      </div>

      {pace.budget !== null && tick !== null && (
        <div aria-hidden className="relative mt-4 mb-6">
          <div className="bg-track h-3 overflow-hidden rounded-full">
            <i
              className="block h-full rounded-full"
              style={{
                width: `${fill * 100}%`,
                background: "linear-gradient(90deg, var(--ring-warn-from), var(--ring-warn-to))",
              }}
            />
          </div>
          <i
            className="bg-ink absolute -top-1 -bottom-1 w-0.5 rounded-full"
            style={{ left: `${tick * 100}%` }}
          />
          <span
            className="text-ink-muted num absolute top-[calc(100%+4px)] -translate-x-1/2 text-xs whitespace-nowrap"
            style={{ left: `${Math.min(Math.max(tick * 100, 12), 88)}%` }}
          >
            {o.paceSchedule(euro(pace.schedule ?? 0))}
          </span>
        </div>
      )}

      <div aria-hidden className="mt-4 flex h-[72px] items-end gap-[3px]">
        {pace.days.map((d) => {
          const isHigh = d.amount >= pace.threshold;
          const h = d.state === "future" ? 2 : Math.max(3, (d.amount / max) * 56);
          return (
            <div
              key={d.day}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
            >
              {isHigh && (
                <span
                  className="num text-ink-muted absolute text-[10px] leading-none"
                  style={{ bottom: h + 8 }}
                >
                  {plain(d.amount)}
                </span>
              )}
              <i
                className="block w-full min-w-[3px] rounded-[3px]"
                style={{
                  height: h,
                  background: isHigh ? "var(--accent)" : "var(--ink-muted)",
                  opacity: d.state === "future" ? 0.2 : isHigh ? 1 : 0.5,
                }}
              />
              <b
                className="mt-1 block size-1 rounded-full"
                style={{ background: d.state === "today" ? "var(--accent)" : "transparent" }}
              />
            </div>
          );
        })}
      </div>
      <div aria-hidden className="text-ink-muted num mt-1 flex justify-between text-xs">
        <span>{dayLabel(`${month}-01`)}</span>
        <span>{dayLabel(`${month}-15`)}</span>
        <span>{dayLabel(`${month}-${String(last).padStart(2, "0")}`)}</span>
      </div>
      <p className="text-ink-muted mt-2 text-[13px]">{o.paceBars(euro(pace.threshold))}</p>
      <p className="sr-only">{o.paceSummary(high, euro(pace.threshold))}</p>
    </div>
  );
}
