import { useId, type CSSProperties, type ReactNode } from "react";
import type { RingSegment } from "@/lib/view/fixed-ring";
import { arcFor, capFraction } from "@/lib/view/ring-arcs";

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

const RING_MASK = (w: number) =>
  `radial-gradient(farthest-side, transparent calc(100% - ${w}px), #000 calc(100% - ${w}px + .6px))`;

/** Light: where an arc's gradient starts (a paler version of its colour) and ends (the colour itself). */
const pale = (slot: number) => `color-mix(in oklab, ${slotColour(slot)} 68%, white)`;
/** Dark: where an arc starts (dimmer) on its way to the lit end. */
const dim = (slot: number) => `color-mix(in oklab, ${slotColour(slot)} 58%, var(--canvas))`;

/**
 * A ring made of several arcs (the Fixed page: the month's income split by fixed expense; Ahead: net worth split by
 * account). It follows the same rules as the single-colour Ring: the 14px stroke at hero size with round caps;
 * light: each arc a gradient with no glow; dark: each arc a conic gradient that runs from dim to lit, with its own
 * round start, a lit head and a tight glow in its own colour, and a halo behind the ring. Arcs still to pay are lighter.
 * Never an SVG filter, which iPhone Safari clips: the dark glow is a filter on a div.
 */
export function SplitRing({ segments, label, size = 224, children }: SplitRingProps) {
  const id = `split${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const stroke = Math.max(6, Math.round(size * 0.0625));
  const width = (stroke / size) * 100;
  const r = 50 - width / 2; // outer edge exactly on the box
  const cap = capFraction(stroke, size);
  const only = segments.length === 1;
  const arcs = segments.map((s) => ({
    s,
    arc: arcFor({ start: s.start, end: s.end }, cap, GAP / 100, only),
  }));
  const slots = [...new Set(segments.map((s) => s.slot))];
  const dot: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: 0,
    width: stroke,
    height: stroke,
    marginLeft: -stroke / 2,
    borderRadius: "50%",
  };

  return (
    <div className="relative isolate shrink-0" style={{ width: size, height: size }}>
      {/* Dark: a halo behind the ring. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -z-10 hidden rounded-full dark:block"
        style={{
          inset: "-32%",
          background: "radial-gradient(closest-side, var(--glow-accent), transparent 72%)",
        }}
      />
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={label}
        className="absolute inset-0 dark:hidden"
      >
        <defs>
          {slots.map((slot) => (
            <linearGradient key={slot} id={`${id}-${slot}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: pale(slot) }} />
              <stop offset="100%" style={{ stopColor: slotColour(slot) }} />
            </linearGradient>
          ))}
        </defs>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth={width}
          style={{ stroke: "var(--track)" }}
        />
        {arcs.map(({ s, arc }) => (
          <circle
            key={`${s.key}-${s.paid ? "paid" : "open"}`}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth={width}
            strokeLinecap={arc.full ? "butt" : "round"}
            pathLength={100}
            strokeDasharray={`${arc.length * 100} ${100 - arc.length * 100}`}
            strokeDashoffset={-arc.start * 100}
            transform="rotate(-90 50 50)"
            stroke={`url(#${id}-${s.slot})`}
            opacity={s.paid ? 1 : TO_PAY_OPACITY}
          />
        ))}
      </svg>
      <div role="img" aria-label={label} className="absolute inset-0 hidden dark:block">
        <i
          className="absolute inset-0 rounded-full"
          style={{
            background: "var(--track)",
            WebkitMask: RING_MASK(stroke),
            mask: RING_MASK(stroke),
          }}
        />
        {arcs.map(({ s, arc }) => {
          const from = arc.start * 360;
          const length = arc.length * 360;
          const lit = slotColour(s.slot);
          return (
            <div
              key={`${s.key}-${s.paid ? "paid" : "open"}`}
              className="absolute inset-0"
              style={{
                filter: `drop-shadow(0 0 ${stroke * 1.2}px color-mix(in srgb, ${lit} 40%, transparent))`,
                opacity: s.paid ? 1 : TO_PAY_OPACITY,
              }}
            >
              <i
                className="absolute inset-0 rounded-full"
                style={{
                  background: `conic-gradient(from ${from}deg, ${dim(s.slot)} 0deg, ${lit} ${length}deg, transparent ${length}deg)`,
                  WebkitMask: RING_MASK(stroke),
                  mask: RING_MASK(stroke),
                }}
              />
              {!arc.full && (
                <>
                  <i className="absolute inset-0" style={{ transform: `rotate(${from}deg)` }}>
                    <u style={{ ...dot, background: dim(s.slot) }} />
                  </i>
                  <i
                    className="absolute inset-0"
                    style={{ transform: `rotate(${from + length}deg)` }}
                  >
                    <u style={{ ...dot, background: lit, boxShadow: `0 0 10px ${lit}` }} />
                  </i>
                </>
              )}
            </div>
          );
        })}
      </div>
      <div className="absolute inset-0 grid place-content-center text-center">{children}</div>
    </div>
  );
}
