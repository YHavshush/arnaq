import type { Formatter } from "@/lib/view/format";
import type { FixedFlow } from "@/lib/view/fixed-flow";

const W = 400;
const H = 176;
const LEFT = 24;
const RIGHT = 376;
const TOP = 34;
const BOTTOM = 132;

export interface FlowText {
  title: string;
  today: string;
  /** "Lowest point −€632 on 1 Nov, ..." */
  lowest: (amount: string, day: string) => string;
  /** When the balance never drops below where the month starts. */
  neverBelow: (amount: string) => string;
  /** When no balance is known: the chart starts from zero. */
  fromZero: string;
  aria: string;
}

/**
 * The month's fixed items day by day as a running balance of the checking accounts, drawn like the Ahead chart:
 * a line with a dot on each day something happens, red below zero and green above, today dashed, the lowest point
 * ringed and named, and the balance at the end. Few numbers on purpose: the caption says the rest.
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

  const todayDay = today.startsWith(month) ? Number(today.slice(8, 10)) : null;
  const dips = flow.lowest.balance < flow.start;
  const lowestX = x(flow.lowest.day);
  const lowestY = y(flow.lowest.balance);
  const axis = [1, 8, 15, 22, flow.days];

  return (
    <div className="glass grid gap-2 p-4">
      <h2 className="font-display text-lg font-medium">{text.title}</h2>
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
          <g>
            <line
              x1={x(todayDay)}
              x2={x(todayDay)}
              y1={TOP - 12}
              y2={BOTTOM}
              strokeWidth={1.2}
              strokeDasharray="3 4"
              opacity={0.7}
              style={{ stroke: "var(--ink-muted)" }}
            />
            <text
              x={x(todayDay)}
              y={TOP - 16}
              textAnchor="middle"
              className="fill-ink-muted text-[10px]"
            >
              {text.today}
            </text>
          </g>
        )}
        <line
          x1={12}
          x2={W - 12}
          y1={zero}
          y2={zero}
          strokeWidth={1.2}
          strokeDasharray="2 4"
          opacity={0.5}
          style={{ stroke: "var(--ink-muted)" }}
        />
        <path
          d={area}
          clipPath="url(#flow-down)"
          fillOpacity={0.12}
          style={{ fill: "var(--ring-bad-to)" }}
        />
        <path
          d={area}
          clipPath="url(#flow-up)"
          fillOpacity={0.12}
          style={{ fill: "var(--ring-good-to)" }}
        />
        <path
          d={line}
          fill="none"
          strokeWidth={2.2}
          strokeLinejoin="round"
          style={{ stroke: "var(--ring-accent-to)" }}
        />
        {flow.events.map((e) => (
          <circle
            key={e.day}
            cx={x(e.day)}
            cy={y(e.balance)}
            r={3.6}
            style={{ fill: "var(--ring-accent-to)" }}
          />
        ))}
        {dips && (
          <>
            <circle
              cx={lowestX}
              cy={lowestY}
              r={7}
              fill="none"
              strokeWidth={2.2}
              style={{ stroke: "var(--ring-bad-to)" }}
            />
            <text
              x={lowestX + 12}
              y={lowestY + 4}
              className="fill-bad num text-[11px] font-semibold"
            >
              {fmt.euro(flow.lowest.balance)}
            </text>
          </>
        )}
        <text
          x={x(flow.days)}
          y={y(flow.end) - 10}
          textAnchor="end"
          className="fill-ink num text-[11px] font-semibold"
        >
          {fmt.euro(flow.end)}
        </text>
        {axis.map((d) => (
          <text
            key={d}
            x={x(d)}
            y={H - 8}
            textAnchor="middle"
            className="fill-ink-muted text-[10.5px]"
          >
            {d}
          </text>
        ))}
      </svg>
      <p className="text-ink-muted text-[13px] leading-snug">
        {dips
          ? text.lowest(
              fmt.euroSigned(flow.lowest.balance),
              fmt.dayLabel(`${month}-${String(flow.lowest.day).padStart(2, "0")}`),
            )
          : text.neverBelow(fmt.euroSigned(flow.start))}
        {flow.startKnown ? "" : ` ${text.fromZero}`}
      </p>
    </div>
  );
}
