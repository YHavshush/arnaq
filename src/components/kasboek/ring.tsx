import { useId, type ReactNode } from "react";
import type { Tone } from "@/design/tokens";

interface RingProps {
  /** 0..1 (values above 1 draw a full ring). */
  value: number;
  tone: Tone;
  /** Pixel size of the whole ring. */
  size?: number;
  /** Text alternative: the ring is decorative next to the number it frames. */
  label: string;
  children?: ReactNode;
}

/**
 * The hero ring. Gradient stroke with round caps. Light mode gets a tinted shadow under it
 * (glow F), dark modes a lit head cap (glow D). Never an SVG filter: iPhone Safari clips them.
 */
export function Ring({ value, tone, size = 224, label, children }: RingProps) {
  const id = `ring${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const stroke = Math.max(6, Math.round(size * 0.0625));
  const r = 50 - (stroke / size) * 50 - 0.5;
  const v = Math.max(0, Math.min(value, 1));
  const cap = (stroke / size) * 100;

  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      {/* Light: an offset, tinted shadow straight under the ring. */}
      <div
        aria-hidden
        className="absolute rounded-full dark:hidden"
        style={{
          inset: "14%",
          boxShadow: `0 ${size * 0.1}px ${size * 0.16}px -${size * 0.04}px var(--glow-${tone})`,
        }}
      />
      <svg viewBox="0 0 100 100" role="img" aria-label={label} className="absolute inset-0">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" style={{ stopColor: `var(--ring-${tone}-from)` }} />
            <stop offset="100%" style={{ stopColor: `var(--ring-${tone}-to)` }} />
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
      {/* Dark: the lit head of the arc. */}
      {v > 0 && (
        <div
          aria-hidden
          className="absolute inset-0 hidden dark:block"
          style={{ transform: `rotate(${v * 360}deg)` }}
        >
          <div
            className="absolute left-1/2 rounded-full"
            style={{
              top: `${50 - r - cap / 2 + 0.2}%`,
              width: `${cap}%`,
              height: `${cap}%`,
              marginLeft: `-${cap / 2}%`,
              background: `var(--ring-${tone}-to)`,
              boxShadow: `0 0 ${size * 0.06}px ${size * 0.015}px var(--glow-${tone})`,
            }}
          />
        </div>
      )}
      <div className="absolute inset-0 grid place-content-center text-center">{children}</div>
    </div>
  );
}
