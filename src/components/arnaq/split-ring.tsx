import type { ReactNode } from "react";
import type { RingSegment } from "@/lib/view/fixed-ring";

/** The colour of each slot: four ring tokens for the largest items, a muted ink for the grouped rest. */
const SLOT_COLOURS = [
  "var(--ring-accent-from)",
  "var(--ring-accent-to)",
  "var(--ring-good-to)",
  "var(--ring-warn-to)",
  "var(--ink-muted)",
];

export const slotColour = (slot: number) =>
  SLOT_COLOURS[slot] ?? SLOT_COLOURS[SLOT_COLOURS.length - 1];

/** How much lighter an arc is while it is still to pay (the same 38% as the Today ring). */
export const TO_PAY_OPACITY = 0.38;

/** Room between neighbouring arcs, in 1/100 of the circle. */
const GAP = 0.6;

interface SplitRingProps {
  segments: RingSegment[];
  /** Text alternative: the arcs are decorative next to the numbers around them. */
  label: string;
  /** Pixel size of the whole ring. */
  size?: number;
  children?: ReactNode;
}

/**
 * The Fixed page ring: the month's income as a circle, every fixed expense an arc of it.
 * Paid arcs are solid, arcs still to pay are lighter, and the empty rest is what is left over.
 * Plain stroked circles (`pathLength` 100, so a length is a percentage); never an SVG filter, which
 * iPhone Safari clips. The dark halo is a gradient on a div, as in the Ring.
 */
export function SplitRing({ segments, label, size = 224, children }: SplitRingProps) {
  const stroke = Math.max(6, Math.round(size * 0.0625));
  const width = (stroke / size) * 100;
  const r = 50 - width / 2; // outer edge exactly on the box
  return (
    <div className="relative isolate shrink-0" style={{ width: size, height: size }}>
      <div
        aria-hidden
        className="pointer-events-none absolute -z-10 hidden rounded-full dark:block"
        style={{
          inset: "-32%",
          background: "radial-gradient(closest-side, var(--glow-accent), transparent 72%)",
        }}
      />
      <svg viewBox="0 0 100 100" role="img" aria-label={label} className="absolute inset-0">
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth={width}
          style={{ stroke: "var(--track)" }}
        />
        {segments.map((s, i) => {
          const next = segments[i + 1];
          const gap = (next && next.key !== s.key) || (!next && s.end >= 1 && i > 0) ? GAP : 0;
          const length = Math.max(0.4, s.length * 100 - gap);
          return (
            <circle
              key={`${s.key}-${s.paid ? "paid" : "open"}`}
              cx="50"
              cy="50"
              r={r}
              fill="none"
              strokeWidth={width}
              pathLength={100}
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={-s.start * 100}
              transform="rotate(-90 50 50)"
              style={{ stroke: slotColour(s.slot) }}
              opacity={s.paid ? 1 : TO_PAY_OPACITY}
            />
          );
        })}
      </svg>
      <div className="absolute inset-0 grid place-content-center text-center">{children}</div>
    </div>
  );
}
