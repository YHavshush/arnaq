import { useId, type CSSProperties, type ReactNode } from "react";
import type { Tone } from "@/design/tokens";

interface RingProps {
  /** 0..1 (values above 1 draw a full ring). */
  value: number;
  /** 0..1: a lighter arc that continues after `value` (what is already spoken for but not spent yet). */
  ahead?: number;
  tone: Tone;
  /** Pixel size of the whole ring. */
  size?: number;
  /** Text alternative: the ring is decorative next to the number it frames. */
  label: string;
  children?: ReactNode;
}

const RING_MASK = (w: number) =>
  `radial-gradient(farthest-side, transparent calc(100% - ${w}px), #000 calc(100% - ${w}px + .6px))`;

/**
 * The hero ring, as in docs/design/ontwerp-v14.html.
 * Light: gradient stroke with round caps, no glow (A, decided 2026-10-16; F, a tinted shadow
 * underneath, is in git history).
 * Dark: a conic ring (colour runs along the arc) with a round start cap, a lit head, a soft glow
 * around it and a halo behind it (glow D).
 * Never a filter on an SVG element: iPhone Safari clips it. The dark glow is a filter on a div.
 */
export function Ring({ value, ahead = 0, tone, size = 224, label, children }: RingProps) {
  const id = `ring${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const stroke = Math.max(6, Math.round(size * 0.0625));
  const r = 50 - (stroke / size) * 50; // outer edge exactly on the box; the svg overflows visibly so round caps are never clipped
  const v = Math.max(0, Math.min(value, 1));
  const cap = (stroke / size) * 100;
  const soft = Math.max(0, Math.min(ahead, 1 - v));

  const dot: CSSProperties = {
    position: "absolute",
    left: "50%",
    top: 0,
    width: stroke,
    height: stroke,
    marginLeft: -stroke / 2,
    borderRadius: "50%",
  };
  const from = `var(--ring-${tone}-from)`;
  const to = `var(--ring-${tone}-to)`;

  return (
    <div className="relative isolate shrink-0" style={{ width: size, height: size }}>
      {/* Dark: a halo behind the ring. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -z-10 hidden rounded-full dark:block"
        style={{
          inset: "-32%",
          background: `radial-gradient(closest-side, var(--glow-${tone}), transparent 72%)`,
        }}
      />
      <svg
        viewBox="0 0 100 100"
        role="img"
        aria-label={label}
        className="absolute inset-0 dark:hidden"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: from }} />
            <stop offset="100%" style={{ stopColor: to }} />
          </linearGradient>
        </defs>
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          strokeWidth={cap}
          style={{ stroke: "var(--track)" }}
        />
        {soft > 0 && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth={cap}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${soft * 100} 100`}
            strokeDashoffset={-v * 100}
            transform="rotate(-90 50 50)"
            stroke={`url(#${id})`}
            opacity={0.38}
          />
        )}
        {v > 0 && (
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            strokeWidth={cap}
            strokeLinecap="round"
            pathLength={100}
            strokeDasharray={`${v * 100} 100`}
            transform="rotate(-90 50 50)"
            stroke={`url(#${id})`}
          />
        )}
      </svg>
      <div
        role="img"
        aria-label={label}
        className="absolute inset-0 hidden dark:block"
        style={{
          filter: `drop-shadow(0 0 ${stroke * 1.2}px color-mix(in srgb, ${to} 40%, transparent))`,
        }}
      >
        <i
          className="absolute inset-0 rounded-full"
          style={{
            background: "var(--track)",
            WebkitMask: RING_MASK(stroke),
            mask: RING_MASK(stroke),
          }}
        />
        {soft > 0 && (
          <i
            className="absolute inset-0 rounded-full"
            style={{
              background: `conic-gradient(from ${v * 360}deg, ${to} ${soft * 360}deg, transparent ${soft * 360}deg)`,
              opacity: 0.38,
              WebkitMask: RING_MASK(stroke),
              mask: RING_MASK(stroke),
            }}
          />
        )}
        {v > 0 && (
          <>
            <i
              className="absolute inset-0 rounded-full"
              style={{
                background: `conic-gradient(from 0deg, ${from}, ${to} ${v * 100}%, transparent ${v * 100}%)`,
                WebkitMask: RING_MASK(stroke),
                mask: RING_MASK(stroke),
              }}
            />
            <i style={{ ...dot, background: from }} />
            <i className="absolute inset-0" style={{ transform: `rotate(${v * 360}deg)` }}>
              <u style={{ ...dot, background: to, boxShadow: `0 0 10px ${to}` }} />
            </i>
          </>
        )}
      </div>
      <div className="absolute inset-0 grid place-content-center text-center">{children}</div>
    </div>
  );
}
