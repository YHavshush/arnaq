"use client";

import { useState } from "react";
import { euro, euroSigned, monthName } from "@/lib/view/format";
import type { PrognosePoint } from "@/lib/view/prognose";

const W = 600;
const H = 250;
const PAD = { l: 14, r: 14, t: 34, b: 48 };

const KIND: Record<PrognosePoint["kind"], string> = {
  actual: "Werkelijk",
  "no-data": "Geen upload",
  mixed: "Lopende maand: werkelijk tot nu toe plus verwacht",
  forecast: "Voorspelling",
};

/**
 * Cumulative growth month by month. Real months are solid, forecast months dashed. Every value is
 * printed (balance above the point, month growth below) until there are too many months to read;
 * then only the selected one. Tap a month, or use the left and right arrow keys, to see its details underneath.
 */
export function PrognoseChart({
  points,
  currentMonth,
}: {
  points: PrognosePoint[];
  currentMonth: string;
}) {
  const [picked, setPicked] = useState<string>(currentMonth);
  const selected = points.find((p) => p.month === picked) ?? points[0];

  const values = points.map((p) => p.cumulative);
  const lo = Math.min(0, ...values);
  const hi = Math.max(0, ...values);
  const span = hi - lo || 1;
  const x = (i: number) =>
    PAD.l +
    (points.length === 1
      ? (W - PAD.l - PAD.r) / 2
      : (i * (W - PAD.l - PAD.r)) / (points.length - 1));
  const y = (v: number) => PAD.t + ((hi - v) / span) * (H - PAD.t - PAD.b);
  const crowded = points.length > 8;
  const firstProjected = points.findIndex((p) => p.projected);

  const seg = (from: number, to: number) =>
    points
      .slice(from, to + 1)
      .map(
        (p, k) => `${k === 0 ? "M" : "L"}${x(from + k).toFixed(1)} ${y(p.cumulative).toFixed(1)}`,
      )
      .join(" ");
  const solidTo = firstProjected === -1 ? points.length - 1 : Math.max(firstProjected - 1, 0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        role="group"
        aria-label="Verloop van je geld per maand"
      >
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(0)}
          y2={y(0)}
          style={{ stroke: "var(--hair)" }}
          strokeWidth="1.5"
        />
        {solidTo > 0 && (
          <path
            d={seg(0, solidTo)}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ stroke: "var(--accent)" }}
          />
        )}
        {firstProjected !== -1 && points.length > 1 && (
          <path
            d={seg(Math.max(firstProjected - 1, 0), points.length - 1)}
            fill="none"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray="6 5"
            style={{ stroke: "var(--accent)" }}
          />
        )}
        {points.map((p, i) => {
          const isSel = p.month === selected.month;
          const showLabels = !crowded || isSel;
          const band = points.length === 1 ? W : (W - PAD.l - PAD.r) / (points.length - 1);
          return (
            <g
              key={p.month}
              role="button"
              id={`pm-${p.month}`}
              tabIndex={isSel ? 0 : -1}
              aria-pressed={isSel}
              aria-label={`${monthName(p.month)}: ${euroSigned(p.cumulative)} totaal, ${euroSigned(p.net)} deze maand`}
              onClick={() => setPicked(p.month)}
              onKeyDown={(e) => {
                const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
                if (step !== 0) {
                  e.preventDefault();
                  const next = points[Math.min(Math.max(i + step, 0), points.length - 1)];
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
              <rect x={x(i) - band / 2} y={0} width={band} height={H} fill="transparent" />
              <circle
                cx={x(i)}
                cy={y(p.cumulative)}
                r={13}
                fill="none"
                strokeWidth="2"
                className="opacity-0 group-focus-visible:opacity-100"
                style={{ stroke: "var(--accent)" }}
              />
              <circle
                cx={x(i)}
                cy={y(p.cumulative)}
                r={isSel ? 6.5 : 4.5}
                strokeWidth="3"
                className="hit"
                style={{ fill: "var(--surface)", stroke: "var(--accent)" }}
              />
              {showLabels && (
                <>
                  <text
                    x={x(i)}
                    y={y(p.cumulative) - 12}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight={isSel ? 650 : 500}
                    style={{ fill: isSel ? "var(--ink)" : "var(--ink-muted)" }}
                    className="num"
                  >
                    {euro(p.cumulative)}
                  </text>
                  <text
                    x={x(i)}
                    y={H - 24}
                    textAnchor="middle"
                    fontSize="11"
                    style={{ fill: "var(--ink-muted)" }}
                    className="num"
                  >
                    {euroSigned(p.net)}
                  </text>
                </>
              )}
              <text
                x={x(i)}
                y={H - 8}
                textAnchor="middle"
                fontSize="12"
                fontWeight={isSel ? 650 : 500}
                style={{ fill: isSel ? "var(--ink)" : "var(--ink-muted)" }}
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-ink-muted px-2 pb-2 text-[13px]">
        <span
          aria-hidden
          className="mr-1 inline-block h-0.5 w-5 align-middle"
          style={{ background: "var(--accent)" }}
        />{" "}
        werkelijk
        <span
          aria-hidden
          className="mr-1 ml-4 inline-block h-0.5 w-5 border-t-2 border-dashed align-middle"
          style={{ borderColor: "var(--accent)" }}
        />
        voorspeld. Boven elk punt staat je totaal, eronder de groei van die maand.
      </p>

      <div className="border-hair mx-2 mb-3 grid gap-1 border-t pt-4" aria-live="polite">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-display text-xl font-medium">{monthName(selected.month)}</h3>
          <span className="text-ink-muted text-[13px]">{KIND[selected.kind]}</span>
        </div>
        <dl className="num grid grid-cols-3 gap-2 text-center">
          {[
            ["Inkomen", euro(selected.income)],
            ["Uitgaven", euro(selected.expenses)],
            ["Groei", euroSigned(selected.net)],
          ].map(([k, v]) => (
            <div key={k} className="bg-soft rounded-2xl px-2 py-3">
              <dt className="text-ink-muted text-[13px]">{k}</dt>
              <dd className="text-lg font-semibold tracking-tight">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <table className="sr-only">
        <caption>Prognose per maand</caption>
        <thead>
          <tr>
            <th>Maand</th>
            <th>Totaal</th>
            <th>Groei</th>
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
