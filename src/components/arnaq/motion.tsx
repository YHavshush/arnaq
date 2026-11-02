"use client";

import { useId, useLayoutEffect, useRef } from "react";
import { LETTER_A, LETTER_Q } from "./logo";

/**
 * The arnaq animations, all drawn from the logo's ring and stem.
 * - WordmarkReveal: the signature, "the turn": the icon's a and q roll apart and r, n, a are drawn between them.
 * - ChaseSpinner: quick waits. BreatheLoader: waits with no known length. DoneRing: finished.
 * Everything stands still (or shows the finished state) when the device asks for reduced motion.
 */
const BLUE = { stroke: "var(--ring-accent-from)" } as const;
const PURPLE = { stroke: "var(--ring-accent-to)" } as const;
const lines = {
  fill: "none",
  strokeWidth: 16,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;
const EASE = "cubic-bezier(.45,.05,.2,1)";
const SEEN = "arnaq-signature-seen";

const R = <path d="M8 8 V49 M8 26 C8 14 16 8 32 8" />;
const N = <path d="M8 8 V49 M8 26 C8 14 18 8 28.5 8 C39 8 49 14 49 26 V49" />;

/**
 * The wordmark, playing the signature once per browser session (the first time it is on screen), and a
 * still wordmark otherwise. The server renders the finished word, so nothing flashes or moves for
 * search engines, slow connections or people who prefer no motion.
 */
export function WordmarkReveal({ className, title }: { className?: string; title?: string }) {
  const root = useRef<SVGSVGElement>(null);
  const id = useId();

  useLayoutEffect(() => {
    const svg = root.current;
    if (!svg || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      if (sessionStorage.getItem(SEEN)) return;
    } catch {
      return; // no storage: show the still word
    }
    const q = <T extends Element>(sel: string) => svg.querySelectorAll<T>(sel);
    const rolls = [...q<SVGGElement>("[data-roll]")];
    for (const g of rolls)
      Object.assign(g.style, { transformBox: "fill-box", transformOrigin: "20.5px 20.5px" });
    const strokes = [
      ...q<SVGGeometryElement>("[data-ltr] path, [data-ltr] circle, [data-ltr] line"),
    ];
    const anims: Animation[] = [];
    const run = (el: Element, kf: Keyframe[], o: KeyframeAnimationOptions) =>
      anims.push(el.animate(kf, { fill: "both", ...o }));
    for (const e of strokes) {
      const len = e.getTotalLength();
      e.style.strokeDasharray = `${len} ${len}`;
      e.style.opacity = "0";
    }
    // The a and q start as the icon (centred, blue and purple) and roll out to the word.
    const DX = 91.5;
    const [a, qq] = rolls;
    run(
      a,
      [
        { transform: `translateX(${DX}px) rotate(0deg)` },
        { transform: "translateX(0) rotate(-360deg)" },
      ],
      { delay: 500, duration: 1250, easing: EASE },
    );
    run(
      qq,
      [
        { transform: `translateX(${-DX}px) rotate(0deg)` },
        { transform: "translateX(0) rotate(360deg)" },
      ],
      { delay: 500, duration: 1250, easing: EASE },
    );
    for (const g of rolls) {
      run(g.querySelector("[data-c1]")!, [{ opacity: 1 }, { opacity: 0 }], {
        delay: 600,
        duration: 1000,
      });
      run(g.querySelector("[data-c2]")!, [{ opacity: 0 }, { opacity: 1 }], {
        delay: 600,
        duration: 1000,
      });
    }
    q<SVGGElement>("[data-ltr]").forEach((g, i) => {
      const d = 850 + i * 170;
      g.querySelectorAll<SVGGeometryElement>("path, circle, line").forEach((e, k) => {
        const len = e.getTotalLength();
        run(e, [{ opacity: 0 }, { opacity: 1 }], { delay: d + k * 120, duration: 40 });
        run(e, [{ strokeDashoffset: len }, { strokeDashoffset: 0 }], {
          delay: d + k * 120,
          duration: 520,
          easing: "cubic-bezier(.3,.8,.3,1)",
        });
      });
    });
    run(
      svg,
      [
        { transform: "scale(1)" },
        { transform: "scale(1.035)", offset: 0.5 },
        { transform: "scale(1)" },
      ],
      { delay: 1900, duration: 520, easing: "ease-in-out" },
    );
    // Seen once it has played to the end (so a development double-run or an early navigation replays it).
    anims[anims.length - 1].onfinish = () => {
      try {
        sessionStorage.setItem(SEEN, "1");
      } catch {
        /* no storage: it may play again, which is harmless */
      }
    };
    return () => {
      for (const x of anims) x.cancel();
      for (const e of strokes) {
        e.style.strokeDasharray = "";
        e.style.opacity = "";
      }
    };
  }, []);

  return (
    <svg
      ref={root}
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
        <g data-ltr transform="translate(66 0)">
          {R}
        </g>
        <g data-ltr transform="translate(115 0)">
          {N}
        </g>
        <g data-ltr transform="translate(181 0)">
          {LETTER_A}
        </g>
      </g>
      <g>
        <g data-roll>
          <g data-c1 style={{ ...BLUE, opacity: 0 }}>
            {LETTER_A}
          </g>
          <g data-c2 stroke="currentColor">
            {LETTER_A}
          </g>
        </g>
      </g>
      <g transform="translate(247 0)">
        <g data-roll>
          <g data-c1 style={{ ...PURPLE, opacity: 0 }}>
            {LETTER_Q}
          </g>
          <g data-c2 stroke={`url(#${id})`}>
            {LETTER_Q}
          </g>
        </g>
      </g>
    </svg>
  );
}

/** Quick waits (a button, a page change): the a's ring with a gradient arc running round it. */
export function ChaseSpinner({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      viewBox="-8 -8 73 73"
      className={className}
      aria-hidden
      fill="none"
      strokeWidth={10}
      strokeLinecap="round"
    >
      <circle cx="28.5" cy="28.5" r="20.5" style={{ stroke: "var(--track)" }} />
      <g className="arnaq-chase">
        <circle cx="28.5" cy="28.5" r="20.5" style={BLUE} strokeDasharray="46 83" />
      </g>
    </svg>
  );
}

/**
 * Longer waits with no known length: the a and the q stay where they are and breathe, the a first and the q a moment
 * later (see `.arnaq-breathe` in globals.css). Only size and opacity change, so it stays calm even when it plays for a
 * moment, and it stands still when the device asks for less motion.
 */
export function BreatheLoader({ className = "w-[150px]" }: { className?: string }) {
  return (
    <svg viewBox="-6 -6 133 90" className={className} aria-hidden {...lines}>
      <g style={BLUE}>
        <g className="arnaq-breathe">{LETTER_A}</g>
      </g>
      <g transform="translate(64 0)" style={PURPLE}>
        <g className="arnaq-breathe arnaq-breathe-late">{LETTER_Q}</g>
      </g>
    </svg>
  );
}

/** Finished: the ring closes in green and the tick draws itself, once. */
export function DoneRing({ className = "size-9" }: { className?: string }) {
  const ring = useRef<SVGCircleElement>(null);
  const tick = useRef<SVGPathElement>(null);
  useLayoutEffect(() => {
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const draw = (el: SVGGeometryElement | null, delay: number, ms: number) => {
      if (!el) return;
      const len = el.getTotalLength();
      el.style.strokeDasharray = `${len} ${len}`;
      if (reduced) return;
      el.animate(
        [
          { strokeDashoffset: len, opacity: 0 },
          { strokeDashoffset: len, opacity: 1, offset: 0.01 },
          { strokeDashoffset: 0, opacity: 1 },
        ],
        { delay, duration: ms, easing: "cubic-bezier(.3,.8,.3,1)", fill: "both" },
      );
    };
    draw(ring.current, 0, 650);
    draw(tick.current, 500, 450);
  }, []);
  return (
    <svg
      viewBox="0 0 104 104"
      className={className}
      aria-hidden
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle
        ref={ring}
        cx="52"
        cy="52"
        r="46"
        strokeWidth={7}
        transform="rotate(-90 52 52)"
        style={{ stroke: "var(--ring-good-to)" }}
      />
      <path
        ref={tick}
        d="M32 54 L45 67 L71 38"
        strokeWidth={7}
        style={{ stroke: "var(--ring-good-to)" }}
      />
    </svg>
  );
}
