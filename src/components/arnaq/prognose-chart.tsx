"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { formatter } from "@/lib/view/format";
import type { PrognosePoint } from "@/lib/view/prognose";
import { MonthDetail } from "./month-detail";

const H = 300;
/** The extra room under the growth row for the lowest-point mark (only when a month dips below zero). */
const LOW_ROW = 22;
const PAD = { l: 24, r: 24, t: 46 };
const PLOT_BOTTOM = H - 64;
const MONTH_Y = H - 40;
const DELTA_Y = H - 18;
const LOW_Y = H + 4;

type View = "total" | "monthly";

interface Pt {
  x: number;
  y: number;
}

/** Slopes for a monotone cubic curve (Fritsch-Carlson): smooth, and never overshoots between points. */
function tangents(p: Pt[]): number[] {
  const n = p.length;
  if (n < 2) return [0];
  const m = p.slice(0, -1).map((a, i) => (p[i + 1].y - a.y) / (p[i + 1].x - a.x));
  const t: number[] = new Array(n).fill(0);
  t[0] = m[0];
  t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  return t;
}

const f1 = (n: number) => n.toFixed(1);

/** The curve through points `a..b` (inclusive), using slopes computed over all points. */
function curve(p: Pt[], t: number[], a: number, b: number): string {
  let d = `M${f1(p[a].x)} ${f1(p[a].y)}`;
  for (let i = a; i < b; i++) {
    const h = (p[i + 1].x - p[i].x) / 3;
    d += ` C${f1(p[i].x + h)} ${f1(p[i].y + t[i] * h)} ${f1(p[i + 1].x - h)} ${f1(p[i + 1].y - t[i + 1] * h)} ${f1(p[i + 1].x)} ${f1(p[i + 1].y)}`;
  }
  return d;
}

/**
 * Money month by month, in two views. "Total": a smooth line of the running total with a soft fill
 * under it; real months are solid, forecast months dashed. "Per month": the growth of each month as a
 * bar. Every value is printed (total above each point, growth below, green for plus and red for
 * minus) until there are too many months to read; then only the selected one. Tap a month, or use
 * the left and right arrow keys, to see its details underneath.
 */
export function PrognoseChart({
  points,
  currentMonth,
  balance = false,
  basisControl,
}: {
  points: PrognosePoint[];
  currentMonth: string;
  /** What the forecast is based on, as a small choice at the bottom of the card (left of the legend). */
  basisControl?: ReactNode;
  /** The values are the person's real balance (the bank's figures), not growth since the first month. */
  balance?: boolean;
}) {
  const { locale, t } = useI18n();
  const { euro, euroSigned, delta, plain, monthName } = formatter(locale);
  // The drawing is as wide as its box, so text keeps its real size on a phone instead of shrinking.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(600);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const watch = new ResizeObserver(([entry]) =>
      setW(Math.max(280, Math.round(entry.contentRect.width))),
    );
    watch.observe(el);
    return () => watch.disconnect();
  }, []);
  const [picked, setPicked] = useState<string>(currentMonth);
  const [view, setView] = useState<View>("total");
  const gid = `area${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const selected = points.find((p) => p.month === picked) ?? points[0];

  const n = points.length;
  const values = points.map((p) => (view === "total" ? p.cumulative : p.net));
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const step = n === 1 ? W - PAD.l - PAD.r : (W - PAD.l - PAD.r) / (n - 1);
  const x = (i: number) => PAD.l + (n === 1 ? step / 2 : i * step);
  const y = (v: number) => PAD.t + ((hi - v) / span) * (PLOT_BOTTOM - PAD.t);
  // Print every value while a column is wide enough for a number like "1,234"; otherwise only the selected one.
  const crowded = step < 40;
  const labelEvery = Math.max(1, Math.ceil(34 / step));
  const firstProjected = points.findIndex((p) => p.projected);
  const solidTo = firstProjected === -1 ? n - 1 : Math.max(firstProjected - 1, 0);

  const dips = view === "total" && points.some((p) => p.low !== null && p.low.amount < 0);
  const height = H + (dips ? LOW_ROW : 0);
  const pts: Pt[] = points.map((p, i) => ({ x: x(i), y: y(p.cumulative) }));
  const slopes = tangents(pts);
  const tone = (v: number) => (v > 0 ? "var(--good)" : v < 0 ? "var(--bad)" : "var(--ink-muted)");
  const bandW = Math.max(Math.min(step * 0.9, 74), 40);
  const barW = Math.min(30, step * 0.5);

  return (
    <div ref={box}>
      <div className="flex justify-end px-1 pb-1">
        <div role="group" aria-label={t.ui.chart.viewLabel} className="liquid seg">
          {(["total", "monthly"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className="seg-item inline-flex min-h-9 items-center justify-center px-3 text-sm font-semibold"
            >
              {v === "total"
                ? balance
                  ? t.ui.chart.viewBalance
                  : t.ui.chart.viewTotal
                : t.ui.chart.viewMonthly}
            </button>
          ))}
        </div>
      </div>

      <svg
        viewBox={`0 0 ${W} ${height}`}
        width={W}
        height={height}
        className="block h-auto w-full overflow-visible"
        role="group"
        aria-label={t.ui.chart.aria}
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--mark)", stopOpacity: 0.26 }} />
            <stop offset="100%" style={{ stopColor: "var(--mark)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>

        {/* The selected month. */}
        {n > 0 && (
          <rect
            x={x(points.indexOf(selected)) - bandW / 2}
            y={6}
            width={bandW}
            height={height - 10}
            rx={16}
            style={{ fill: "var(--track)" }}
          />
        )}

        <line
          x1={PAD.l - 10}
          x2={W - PAD.r + 10}
          y1={y(0)}
          y2={y(0)}
          style={{ stroke: "var(--hair)" }}
          strokeWidth="1.5"
        />

        {view === "total" && n > 1 && (
          <>
            <path
              d={`${curve(pts, slopes, 0, n - 1)} L${f1(pts[n - 1].x)} ${PLOT_BOTTOM} L${f1(pts[0].x)} ${PLOT_BOTTOM} Z`}
              style={{ fill: `url(#${gid})` }}
            />
            {solidTo > 0 && (
              <path
                d={curve(pts, slopes, 0, solidTo)}
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
                style={{ stroke: "var(--mark)" }}
              />
            )}
            {firstProjected !== -1 && (
              <path
                d={curve(pts, slopes, Math.max(firstProjected - 1, 0), n - 1)}
                fill="none"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeDasharray="6 5"
                style={{ stroke: "var(--mark)" }}
              />
            )}
          </>
        )}

        {points.map((p, i) => {
          const isSel = p.month === selected.month;
          const showValues = !crowded || isSel;
          const showMonth = isSel || i % labelEvery === 0;
          const v = view === "total" ? p.cumulative : p.net;
          const barTop = Math.min(y(0), y(p.net));
          const barH = Math.max(Math.abs(y(p.net) - y(0)), 2);
          return (
            <g
              key={p.month}
              role="button"
              id={`pm-${p.month}`}
              tabIndex={isSel ? 0 : -1}
              aria-pressed={isSel}
              aria-label={t.ui.chart.month(
                monthName(p.month),
                euroSigned(p.cumulative),
                euroSigned(p.net),
              )}
              onClick={() => setPicked(p.month)}
              onKeyDown={(e) => {
                const move = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (move !== 0) {
                  e.preventDefault();
                  const next = points[Math.min(Math.max(i + move, 0), n - 1)];
                  setPicked(next.month);
                  // The roving tab stop moves with the selection; focus follows once it renders.
                  requestAnimationFrame(() => document.getElementById(`pm-${next.month}`)?.focus());
                } else if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setPicked(p.month);
                }
              }}
              className="group cursor-pointer outline-none"
            >
              <rect
                x={x(i) - step / 2}
                y={0}
                width={Math.max(step, 28)}
                height={height}
                fill="transparent"
              />
              <rect
                x={x(i) - bandW / 2}
                y={6}
                width={bandW}
                height={height - 10}
                rx={16}
                fill="none"
                strokeWidth="2"
                className="opacity-0 group-focus-visible:opacity-100"
                style={{ stroke: "var(--mark)" }}
              />

              {view === "total" ? (
                <circle
                  cx={x(i)}
                  cy={y(p.cumulative)}
                  r={isSel ? 6.5 : 4}
                  strokeWidth={isSel ? 3 : 2.5}
                  style={{
                    fill: isSel ? "var(--surface)" : "var(--mark)",
                    stroke: "var(--mark)",
                  }}
                />
              ) : (
                <rect
                  x={x(i) - barW / 2}
                  y={barTop}
                  width={barW}
                  height={barH}
                  rx={5}
                  strokeWidth={p.projected ? 1.5 : 0}
                  strokeDasharray={p.projected ? "4 3" : undefined}
                  style={{
                    fill: p.net >= 0 ? "var(--ring-good-to)" : "var(--ring-bad-to)",
                    fillOpacity: p.projected ? 0.4 : 1,
                    stroke: p.net >= 0 ? "var(--ring-good-to)" : "var(--ring-bad-to)",
                  }}
                />
              )}

              {showValues && (
                <>
                  {view === "total" ? (
                    <text
                      x={x(i)}
                      y={y(v) - 14}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight={isSel ? 700 : 600}
                      style={{
                        fill:
                          p.cumulative < 0
                            ? "var(--bad)"
                            : isSel
                              ? "var(--ink)"
                              : "var(--ink-muted)",
                      }}
                      className="num"
                    >
                      {plain(p.cumulative)}
                    </text>
                  ) : (
                    <text
                      x={x(i)}
                      y={p.net >= 0 ? y(p.net) - 8 : y(p.net) + 18}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight={700}
                      style={{ fill: tone(p.net) }}
                      className="num"
                    >
                      {delta(p.net)}
                    </text>
                  )}
                  {view === "total" && (
                    <text
                      x={x(i)}
                      y={DELTA_Y}
                      textAnchor="middle"
                      fontSize="13"
                      fontWeight={700}
                      style={{ fill: tone(p.net) }}
                      className="num"
                    >
                      {delta(p.net)}
                    </text>
                  )}
                </>
              )}
              {view === "total" && p.low !== null && p.low.amount < 0 && (
                <>
                  <circle cx={x(i)} cy={LOW_Y} r={3.5} style={{ fill: "var(--bad)" }} />
                  {showValues && (isSel || step >= 76) && (
                    <text
                      x={i === n - 1 ? x(i) + 12 : i === 0 ? x(i) - 12 : x(i)}
                      y={LOW_Y + 16}
                      textAnchor={i === n - 1 ? "end" : i === 0 ? "start" : "middle"}
                      fontSize="11"
                      fontWeight={700}
                      style={{ fill: "var(--bad)" }}
                      className="num"
                    >
                      {t.ui.chart.lowShort(euro(p.low.amount))}
                    </text>
                  )}
                </>
              )}
              {showMonth && (
                <text
                  x={x(i)}
                  y={MONTH_Y}
                  textAnchor="middle"
                  fontSize="13"
                  fontWeight={isSel ? 700 : 500}
                  style={{ fill: isSel ? "var(--ink)" : "var(--ink-muted)" }}
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      <div className="text-ink-muted flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-2 pb-2 text-[13px]">
        <span>
          <span
            aria-hidden
            className="mr-1 inline-block h-0.5 w-5 align-middle"
            style={{ background: "var(--mark)" }}
          />{" "}
          {t.ui.chart.legendActual}
          <span
            aria-hidden
            className="mr-1 ml-4 inline-block h-0.5 w-5 border-t-2 border-dashed align-middle"
            style={{ borderColor: "var(--mark)" }}
          />
          {t.ui.chart.legendForecast}
        </span>
        {basisControl}
      </div>

      <div className="border-hair mx-2 mb-3 grid gap-1 border-t pt-4" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-xl font-medium">{monthName(selected.month)}</h3>
          <span className="text-ink-muted text-[13px]">{t.ui.chart.kind[selected.kind]}</span>
        </div>
        <MonthDetail point={selected} />
      </div>

      <table className="sr-only">
        <caption>{t.ui.chart.table.caption}</caption>
        <thead>
          <tr>
            <th>{t.ui.chart.table.month}</th>
            <th>{t.ui.chart.table.total}</th>
            <th>{t.ui.chart.table.growth}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.month}>
              <td>{monthName(p.month)}</td>
              <td>{euro(p.cumulative)}</td>
              <td>{euroSigned(p.net)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
