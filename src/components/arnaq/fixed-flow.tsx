import type { Formatter } from "@/lib/view/format";
import type { FixedFlow } from "@/lib/view/fixed-flow";

const W = 400;
const H = 190;
const LEFT = 24;
const RIGHT = 376;
const TOP = 22;
const BOTTOM = 150;

export interface FlowText {
  title: string;
  /** "Lowest point −€632 on 1 Nov, ..." */
  lowest: (amount: string, day: string) => string;
  /** When no balance is known: the chart starts from zero. */
  fromZero: string;
  aria: string;
}

/**
 * The month's fixed items day by day as a running balance of the checking accounts, drawn like the Ahead chart: a line
 * with a dot and a number at each day something happens, a soft column on today, red below zero and green above, the
 * lowest point ringed.
 */
export function FixedFlowCard({
  flow,
  month,
  today,
  text,
  fmt,
}: {
  flow: FixedFlow;
  month: string;
  today: string;
  text: FlowText;
  fmt: Pick<Formatter, "euro" | "dayLabel" | "euroSigned">;
}) {
  const x = (day: number) =>
    flow.days <= 1 ? LEFT : LEFT + ((day - 1) * (RIGHT - LEFT)) / (flow.days - 1);
  const all = [flow.start, ...flow.events.map((e) => e.balance), 0];
  const lo = Math.min(...all);
  const hi = Math.max(...all);
  const span = Math.max(hi - lo, 1);
  const y = (v: number) => TOP + ((hi - v) / span) * (BOTTOM - TOP);
  const zero = y(0);

  // The step line: flat until a day something happens, then straight up or down.
  let balance = flow.start;
  const points: [number, number][] = [[x(1), y(balance)]];
  for (const e of flow.events) {
    points.push([x(e.day), y(balance)], [x(e.day), y(e.balance)]);
    balance = e.balance;
  }
  points.push([x(flow.days), y(balance)]);
  const line = points
    .map(([px, py], i) => `${i === 0 ? "M" : "L"}${px.toFixed(1)} ${py.toFixed(1)}`)
    .join(" ");
  const area = `${line} L${x(flow.days).toFixed(1)} ${zero.toFixed(1)} L${x(1).toFixed(1)} ${zero.toFixed(1)}Z`;

  // A number at an event only when it does not sit on top of the last one.
  const labelled = flow.events.reduce<FixedFlow["events"]>((shown, e) => {
    const last = shown.at(-1);
    return last && x(e.day) - x(last.day) < 44 ? shown : [...shown, e];
  }, []);
  const todayDay = today.startsWith(month) ? Number(today.slice(8, 10)) : null;
  const lowestPoint = { px: x(flow.lowest.day), py: y(flow.lowest.balance) };
  const axis = [1, 8, 15, 22, flow.days];

  return (
    <div className="glass grid gap-2 p-4">
      <h2 className="font-display text-xl font-medium">{text.title}</h2>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={text.aria} className="h-auto w-full">
        <defs>
          <clipPath id="flow-up">
            <rect x="0" y="0" width={W} height={zero} />
          </clipPath>
          <clipPath id="flow-down">
            <rect x="0" y={zero} width={W} height={H - zero} />
          </clipPath>
        </defs>
        {todayDay !== null && (
          <rect
            x={x(todayDay) - 11}
            y={8}
            width={22}
            height={BOTTOM - 4}
            rx={11}
            style={{ fill: "var(--soft)" }}
          />
        )}
        <line
          x1={12}
          x2={W - 12}
          y1={zero}
          y2={zero}
          style={{ stroke: "var(--hair)" }}
          strokeWidth={1.5}
        />
        <path
          d={area}
          clipPath="url(#flow-down)"
          style={{ fill: "var(--ring-bad-to)" }}
          fillOpacity={0.18}
        />
        <path
          d={area}
          clipPath="url(#flow-up)"
          style={{ fill: "var(--ring-good-to)" }}
          fillOpacity={0.18}
        />
        <path
          d={line}
          fill="none"
          strokeWidth={2.8}
          strokeLinejoin="round"
          style={{ stroke: "var(--ring-accent-to)" }}
        />
        {flow.events.map((e) => (
          <circle
            key={e.day}
            cx={x(e.day)}
            cy={y(e.balance)}
            r={4.4}
            style={{ fill: "var(--ring-accent-to)" }}
          />
        ))}
        {flow.lowest.balance < flow.start && (
          <circle
            cx={lowestPoint.px}
            cy={lowestPoint.py}
            r={7.5}
            fill="none"
            strokeWidth={2.4}
            style={{ stroke: "var(--ring-bad-to)" }}
          />
        )}
        {labelled.map((e) => (
          <text
            key={e.day}
            x={x(e.day)}
            y={y(e.balance) - 10}
            textAnchor="middle"
            className="fill-ink num text-[10.5px] font-semibold"
          >
            {fmt.euro(e.balance)}
          </text>
        ))}
        {axis.map((d) => (
          <text
            key={d}
            x={x(d)}
            y={H - 16}
            textAnchor="middle"
            className="fill-ink-muted text-[10.5px]"
          >
            {d}
          </text>
        ))}
      </svg>
      <p className="text-ink-muted text-[13px] leading-snug">
        {text.lowest(
          fmt.euroSigned(flow.lowest.balance),
          fmt.dayLabel(`${month}-${String(flow.lowest.day).padStart(2, "0")}`),
        )}
        {flow.startKnown ? "" : ` ${text.fromZero}`}
      </p>
    </div>
  );
}
