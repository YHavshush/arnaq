import { useId } from "react";

/**
 * The arnaq logo, drawn from strokes (so it looks the same on every device and needs no font).
 * Geometry: ring height 57, stroke 16, round ends, units are the design's own (docs/design/logo-arnaq-*.html).
 * Colours come from the design tokens: the a is --ring-accent-from (blue), the q --ring-accent-to (purple),
 * the letters of the word use the current text colour. Never put a CSS filter on these (Safari rule).
 */
const STROKE = 16;
const A = (
  <>
    <circle cx="28.5" cy="28.5" r="20.5" />
    <line x1="49" y1="26.5" x2="49" y2="49" />
  </>
);
const Q = (
  <>
    <circle cx="28.5" cy="28.5" r="20.5" />
    <line x1="49" y1="8" x2="49" y2="70" />
  </>
);
const R = <path d="M8 8 V49 M8 26 C8 14 16 8 32 8" />;
const N = <path d="M8 8 V49 M8 26 C8 14 18 8 28.5 8 C39 8 49 14 49 26 V49" />;

const BLUE = { stroke: "var(--ring-accent-from)" } as const;
const PURPLE = { stroke: "var(--ring-accent-to)" } as const;
const lines = {
  fill: "none",
  strokeWidth: STROKE,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

type LogoProps = {
  className?: string;
  /** The accessible name. Leave out when the logo is decoration next to the name. */
  title?: string;
};

/** The icon: the blue a and the purple q side by side. */
export function Monogram({ className, title }: LogoProps) {
  return (
    <svg
      viewBox="-6 -6 133 90"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...lines}
    >
      <g style={BLUE}>{A}</g>
      <g transform="translate(64 0)" style={PURPLE}>
        {Q}
      </g>
    </svg>
  );
}

/** The word: a, r, n, a in the text colour and the q in the blue-to-purple gradient. */
export function Wordmark({ className, title }: LogoProps) {
  const id = useId();
  return (
    <svg
      viewBox="-6 -6 316 90"
      className={className}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      {...lines}
    >
      <defs>
        <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="57" y2="78">
          <stop offset="0" style={{ stopColor: "var(--ring-accent-from)" }} />
          <stop offset="1" style={{ stopColor: "var(--ring-accent-to)" }} />
        </linearGradient>
      </defs>
      <g stroke="currentColor">
        <g>{A}</g>
        <g transform="translate(66 0)">{R}</g>
        <g transform="translate(115 0)">{N}</g>
        <g transform="translate(181 0)">{A}</g>
      </g>
      <g transform="translate(247 0)" stroke={`url(#${id})`}>
        {Q}
      </g>
    </svg>
  );
}
