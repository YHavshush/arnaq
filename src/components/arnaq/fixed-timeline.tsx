import type { Formatter } from "@/lib/view/format";
import type { FixedFlow } from "@/lib/view/fixed-flow";
import { displayName } from "@/lib/view/names";

export interface TimelineText {
  title: string;
  /** "Lowest −€71 on 1 Nov" */
  lowest: (amount: string, day: string) => string;
  /** When the balance never drops below where the month starts. */
  neverBelow: (amount: string) => string;
  /** When no balance is known: the list starts from zero. */
  fromZero: string;
  /** The header of the balance column. */
  after: string;
}

/**
 * The month in order: each day a fixed item comes in or goes out, what it was, how much, and what the checking
 * accounts hold after it. The lowest balance is red. It says "when" and "how low" without a chart.
 */
export function FixedTimeline({
  flow,
  month,
  text,
  fmt,
}: {
  flow: FixedFlow;
  month: string;
  text: TimelineText;
  fmt: Pick<Formatter, "euro" | "dayLabel" | "euroSigned">;
}) {
  const day = (d: number) => fmt.dayLabel(`${month}-${String(d).padStart(2, "0")}`);
  const dips = flow.lowest.balance < flow.start;
  return (
    <section className="glass grid gap-1 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-medium">{text.title}</h2>
        <span className="text-ink-muted text-[12px]">{text.after}</span>
      </div>
      <ol className="divide-hair divide-y">
        {flow.events.map((e) => {
          const lowest = dips && e.day === flow.lowest.day;
          return (
            <li
              key={e.day}
              className="grid grid-cols-[3.2rem_minmax(0,1fr)_auto_4.2rem] items-baseline gap-2 py-2.5 text-[14px]"
            >
              <span className="text-ink-muted">{day(e.day)}</span>
              <span className="truncate">{e.names.map(displayName).join(", ")}</span>
              <span
                className={`num text-right font-semibold ${e.amount < 0 ? "text-bad" : "text-good"}`}
              >
                {fmt.euroSigned(e.amount)}
              </span>
              <span className={`num text-right font-semibold ${lowest ? "text-bad" : ""}`}>
                {fmt.euro(e.balance)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="text-ink-muted pt-1 text-[13px] leading-snug">
        {dips
          ? text.lowest(fmt.euroSigned(flow.lowest.balance), day(flow.lowest.day))
          : text.neverBelow(fmt.euroSigned(flow.start))}
        {flow.startKnown ? "" : ` ${text.fromZero}`}
      </p>
    </section>
  );
}
