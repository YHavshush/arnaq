"use client";

import { useRouter } from "next/navigation";
import { Moon, Sun } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { applyTheme, readTheme, subscribeTheme } from "@/design/theme-client";
import { useI18n } from "@/i18n/client";
import { SAMPLE_WISH_COOKIE, WELCOMED_COOKIE } from "@/lib/welcome";
import { formatter } from "@/lib/view/format";
import { LanguageSwitcher } from "./language-switcher";
import { LETTER_A, LETTER_Q } from "./logo";
import { Ring } from "./ring";

const EASE = "cubic-bezier(.3,.8,.3,1)";
const BLUE = { stroke: "var(--ring-accent-from)" } as const;
const PURPLE = { stroke: "var(--ring-accent-to)" } as const;
const REDUCED = "(prefers-reduced-motion: reduce)";

/**
 * The three screens' tinted backgrounds, made from the theme's own colours so both themes work. They end in the
 * page's own last colour (--page-end), so the intro finishes like the app does: the cream-peach in light, the
 * deep navy in dark. The dark app background is made with this same recipe (see design/tokens.ts).
 */
const TINT = (a: string, b: string) =>
  `linear-gradient(165deg, color-mix(in oklab, var(${a}) 26%, var(--canvas)), color-mix(in oklab, var(${b}) 22%, var(--canvas)) 55%, var(--page-end))`;
const BACKGROUNDS = [
  TINT("--ring-accent-from", "--ring-accent-to"),
  TINT("--ring-good-from", "--ring-accent-from"),
  TINT("--ring-accent-to", "--ring-accent-from"),
];

const reducedMotion = () => typeof matchMedia === "function" && matchMedia(REDUCED).matches;

/** Run one animation for as long as the screen is on view; the returned function stops everything. */
type Stop = () => void;
const count = (
  el: HTMLElement | null,
  to: number,
  ms: number,
  delay: number,
  show: (v: number) => string,
): Stop => {
  if (!el) return () => {};
  if (reducedMotion()) {
    el.textContent = show(to);
    return () => {};
  }
  let raf = 0;
  const t0 = performance.now() + delay;
  el.textContent = show(0);
  const step = (now: number) => {
    const p = Math.min(1, Math.max(0, (now - t0) / ms));
    el.textContent = show(to * (1 - Math.pow(1 - p, 3)));
    if (p < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
};
const play = (el: Element | null, kf: Keyframe[], o: KeyframeAnimationOptions): Stop => {
  if (!el || reducedMotion()) return () => {};
  const a = el.animate(kf, { fill: "both", ...o });
  return () => a.cancel();
};
const meter = (el: HTMLElement | null, to: number, delay: number, ms: number): Stop => {
  if (!el) return () => {};
  el.style.transform = `scaleX(${to})`;
  return play(el, [{ transform: "scaleX(0)" }, { transform: `scaleX(${to})` }], {
    delay,
    duration: ms,
    easing: EASE,
  });
};
const breathe = (el: Element | null, delay: number, k: number): Stop =>
  play(el, [{ transform: "scale(1)" }, { transform: `scale(${k})` }, { transform: "scale(1)" }], {
    delay,
    duration: 3200,
    iterations: Infinity,
    easing: "ease-in-out",
  });

/** Calls `run` whenever the screen becomes the active one, and cleans up when it leaves. */
function useOnActive(
  active: boolean,
  root: RefObject<HTMLElement | null>,
  run: (el: HTMLElement) => Stop[],
  /** What the animation writes into the page (the language), so it runs again when that changes. */
  deps: readonly unknown[] = [],
) {
  useEffect(() => {
    const el = root.current;
    if (!active || !el) return;
    const stops = run(el);
    return () => {
      for (const s of stops) s();
      // Put the dash back, so the next time the drawing starts from nothing again.
      el.querySelectorAll<SVGElement>("[style*=stroke-dash]").forEach((e) => {
        e.style.strokeDasharray = "";
        e.style.strokeDashoffset = "";
      });
    };
    // `run` is a closure over props that do not change while a screen is on view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, ...deps]);
}

const q = <T extends Element>(el: HTMLElement, sel: string) => el.querySelector(sel) as T | null;

/**
 * The glow behind the visuals: two soft layers (a core and a larger halo) that rise slowly into view, then
 * breathe and drift a little, out of step with each other, so the light feels alive and never repeats exactly.
 * Both fade to nothing at their edge. Under reduced motion they just sit there. `steady` skips the rise: the glow is
 * painted from the first frame (screen 1) and only breathes and drifts.
 */
function Glow({ vault = false, steady = false }: { vault?: boolean; steady?: boolean }) {
  return (
    <>
      <div
        data-glow
        aria-hidden
        className={`absolute size-[340px] rounded-full ${steady ? "" : "opacity-0"}`}
        style={{ background: vault ? "var(--onb-glow-vault)" : "var(--onb-glow)" }}
      />
      <div
        data-glow2
        aria-hidden
        className={`absolute size-[430px] rounded-full ${steady ? "" : "opacity-0"}`}
        style={{ background: vault ? "var(--onb-glow-vault-2)" : "var(--onb-glow-2)" }}
      />
    </>
  );
}
/**
 * `kind`: "rise" fades the layers in (screen 2). "fromZero" is the same, but the wide layer's drift keeps its opacity off
 * the first keyframe, so it does not hold full strength during its start delay and pop on before the rise has begun
 * (screen 3). "steady" has no rise at all: the layers are already there and only breathe and drift (screen 1, which
 * pairs it with `<Glow steady />`).
 */
function glowStops(el: HTMLElement, kind: "rise" | "fromZero" | "steady" = "rise"): Stop[] {
  const main = q(el, "[data-glow]");
  const wide = q(el, "[data-glow2]");
  if (reducedMotion()) {
    for (const g of [main, wide]) if (g) (g as HTMLElement).style.opacity = "1";
    return [];
  }
  const loop = { iterations: Infinity, direction: "alternate" as const, easing: "ease-in-out" };
  if (kind === "steady")
    return [
      play(main, [{ transform: "scale(1)" }, { transform: "scale(1.09)" }], {
        duration: 6000,
        ...loop,
      }),
      play(
        wide,
        [
          { transform: "translate(0, 0) scale(1)", opacity: 1 },
          { transform: "translate(16px, -10px) scale(1.1)", opacity: 0.7 },
        ],
        { duration: 9000, ...loop },
      ),
    ];
  return [
    play(
      main,
      [
        { opacity: 0, transform: "scale(.7)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { delay: 200, duration: 2400, easing: "ease-in-out" },
    ),
    play(
      wide,
      [
        { opacity: 0, transform: "scale(.7)" },
        { opacity: 1, transform: "scale(1)" },
      ],
      { delay: 700, duration: 2800, easing: "ease-in-out" },
    ),
    // After the rise: a slow breath, and a slow drift of the wide layer, out of step.
    play(main, [{ transform: "scale(1)" }, { transform: "scale(1.09)" }], {
      delay: 2600,
      duration: 6000,
      ...loop,
    }),
    play(
      wide,
      [
        {
          transform: "translate(-16px, 10px) scale(1)",
          ...(kind === "fromZero" ? {} : { opacity: 1 }),
        },
        { transform: "translate(16px, -10px) scale(1.1)", opacity: 0.7 },
      ],
      { delay: 3500, duration: 9000, ...loop },
    ),
  ];
}

/** Screen 1: the a and q fly in, meet, and breathe. */
function Hook({ active }: { active: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  useOnActive(active, root, (el) => {
    const a = q<SVGGElement>(el, "[data-la]");
    const qq = q<SVGGElement>(el, "[data-lq]");
    for (const g of [a, qq])
      if (g) Object.assign(g.style, { transformBox: "fill-box", transformOrigin: "center" });
    const mono = q<SVGSVGElement>(el, "[data-mono]");
    return [
      play(
        a,
        [
          { transform: "translateX(-70px) rotate(-200deg)", opacity: 0 },
          { transform: "translateX(0) rotate(0)", opacity: 1 },
        ],
        { duration: 1100, easing: EASE },
      ),
      play(
        qq,
        [
          { transform: "translateX(70px) rotate(200deg)", opacity: 0 },
          { transform: "translateX(0) rotate(0)", opacity: 1 },
        ],
        { duration: 1100, easing: EASE },
      ),
      play(
        mono,
        [
          { transform: "scale(1)" },
          { transform: "scale(1.1)", offset: 0.5 },
          { transform: "scale(1)" },
        ],
        { delay: 1100, duration: 600, easing: "ease-in-out" },
      ),
      breathe(mono, 1800, 1.03),
      ...glowStops(el, "steady"),
      ...[0, 1].map((i) =>
        play(
          el.querySelectorAll("[data-ripple]")[i],
          [
            { transform: "scale(.7)", opacity: 0.5 },
            { transform: "scale(2.2)", opacity: 0 },
          ],
          {
            delay: 1200 + i * 1200,
            duration: 3400,
            iterations: Infinity,
            easing: "ease-out",
          },
        ),
      ),
    ];
  });
  // Visible on both grounds: the soft blue of the logo on dark, a stronger violet-blue on the light dawn.
  const ring: CSSProperties = { borderColor: "var(--onb-ripple)" };
  return (
    <div ref={root} className="relative grid place-items-center">
      <Glow steady />
      {[0, 1].map((i) => (
        <div
          key={i}
          data-ripple
          className="absolute size-[190px] rounded-full border-2 opacity-0"
          style={ring}
        />
      ))}
      <svg
        data-mono
        viewBox="-6 -6 133 90"
        className="relative w-[min(262px,70vw)] overflow-visible"
        fill="none"
        strokeWidth={16}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <g>
          <g data-la style={BLUE}>
            {LETTER_A}
          </g>
        </g>
        <g transform="translate(64 0)">
          <g data-lq style={PURPLE}>
            {LETTER_Q}
          </g>
        </g>
      </svg>
    </div>
  );
}

/** Invented spending per day (euros) for the pace graph: the same look as the app's "pace of the month" card. */
const PACE_DAYS = [105, 8, 0, 44, 0, 0, 12, 0, 0, 6, 75, 0, 15, 0, 0, 0, 81, 0, 12, 0, 0];
const PACE_LAST = 31;
const PACE_TODAY = PACE_DAYS.length;
const PACE_THRESHOLD = 40;
const PACE_MAX = Math.max(...PACE_DAYS);
/** The same demo numbers as the overview: spent, the budget for everyday spending, and where an even pace would be today. */
/** How strongly the dial shows once it has settled (the goal card in front of it is what should stand out). */
const DIAL_OPACITY = 0.75;
const RING_VALUE = 0.72; // 72 per cent of the budget is spent or planned, as in the overview
const PACE_SPENT = 258;
const PACE_BUDGET = 752;
const PACE_SCHEDULE = 509;

/**
 * Screen 2: free to spend in the app's own ring (the same component as the overview), the pace of the
 * month as a small bar graph like the app's, and two budgets filling. On a short screen the graph is left out.
 */
function Flow({ active }: { active: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const { t, locale } = useI18n();
  const w = t.ui.welcome;
  const o = t.ui.overview;
  const f = formatter(locale);
  useOnActive(
    active,
    root,
    (el) => [
      count(q(el, "[data-n]"), 494, 1300, 150, (v) => f.euro(Math.round(v) * 100)),
      count(q(el, "[data-spent]"), PACE_SPENT, 1200, 400, (v) => f.euro(Math.round(v) * 100)),
      meter(q(el, "[data-fill]"), PACE_SPENT / PACE_BUDGET, 500, 1100),
      play(
        q(el, "[data-ringbox]"),
        [
          { transform: "scale(.88)", opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: 900, easing: EASE },
      ),
      play(
        q(el, "[data-pace]"),
        [
          { opacity: 0, transform: "translateY(36px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { delay: 250, duration: 700, easing: EASE },
      ),
      ...[...el.querySelectorAll<HTMLElement>("[data-bar]")].map((bar, i) => {
        bar.style.transformOrigin = "bottom";
        return play(bar, [{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
          delay: 500 + i * 28,
          duration: 450,
          easing: EASE,
        });
      }),
    ],
    [locale],
  );
  // The ring fills from nothing up to where it stands, each time this screen comes into view. While the screen
  // is away it rests at zero, so there is no flash of a full ring on the way in.
  const [fill, setFill] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    if (reducedMotion()) {
      raf = requestAnimationFrame(() => setFill(RING_VALUE));
    } else {
      const t0 = performance.now() + 250;
      const step = (now: number) => {
        const p = Math.min(1, Math.max(0, (now - t0) / 1600));
        setFill(RING_VALUE * (1 - Math.pow(1 - p, 3)));
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }
    return () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setFill(0));
    };
  }, [active]);
  const month = "2026-10";
  return (
    <div
      ref={root}
      className="grid h-full w-full content-evenly justify-items-center gap-6 px-0 pb-4"
    >
      <div data-ringbox className="[@media(max-height:760px)]:[zoom:.82]">
        <Ring value={fill} tone="good" size={200} label={w.freeToSpend}>
          <div
            data-n
            className="num text-[42px] leading-none font-medium tracking-[-0.035em] whitespace-nowrap dark:font-normal"
          />
          <div className="text-ink-muted mt-2 text-sm">{w.freeToSpend}</div>
        </Ring>
      </div>
      <div data-pace className="glass w-full px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="num text-[22px] leading-none font-semibold tracking-tight">
            <span data-spent />
            <span className="text-ink-muted ml-1.5 text-[13px] font-normal">
              {o.paceOf(f.euro(PACE_BUDGET * 100))}
            </span>
          </div>
          <span className="num bg-good/12 text-good rounded-full px-2.5 py-1 text-[12px] font-semibold">
            {o.paceAhead(f.euro((PACE_SCHEDULE - PACE_SPENT) * 100))}
          </span>
        </div>
        <div aria-hidden className="relative mt-3 mb-6">
          <div className="bg-track h-2.5 overflow-hidden rounded-full">
            <i
              data-fill
              className="block h-full w-full origin-left rounded-full"
              style={{
                transform: `scaleX(${PACE_SPENT / PACE_BUDGET})`,
                background: "linear-gradient(90deg, var(--ring-warn-from), var(--ring-warn-to))",
              }}
            />
          </div>
          <i
            className="bg-ink absolute -top-1 -bottom-1 w-0.5 rounded-full"
            style={{ left: `${(PACE_SCHEDULE / PACE_BUDGET) * 100}%` }}
          />
          <span
            className="text-ink-muted num absolute top-[calc(100%+3px)] -translate-x-1/2 text-[11px] whitespace-nowrap"
            style={{ left: `${(PACE_SCHEDULE / PACE_BUDGET) * 100}%` }}
          >
            {o.paceSchedule(f.euro(PACE_SCHEDULE * 100))}
          </span>
        </div>
        <div aria-hidden className="flex h-[56px] items-end gap-[3px]">
          {Array.from({ length: PACE_LAST }, (_, i) => {
            const day = i + 1;
            const future = day > PACE_TODAY;
            const amount = future ? 0 : PACE_DAYS[i];
            const high = amount >= PACE_THRESHOLD;
            const h = future ? 2 : Math.max(3, (amount / PACE_MAX) * 42);
            return (
              <div
                key={day}
                className="relative flex h-full flex-1 flex-col items-center justify-end"
              >
                {high && (
                  <span
                    className="num text-ink-muted absolute text-[9px] leading-none"
                    style={{ bottom: h + 4 }}
                  >
                    {amount}
                  </span>
                )}
                <i
                  data-bar
                  className="block w-full min-w-[3px] rounded-[3px]"
                  style={{
                    height: h,
                    background: high ? "var(--accent)" : "var(--ink-muted)",
                    opacity: future ? 0.2 : high ? 1 : 0.5,
                  }}
                />
              </div>
            );
          })}
        </div>
        <div aria-hidden className="text-ink-muted num mt-1 flex justify-between text-[11px]">
          <span>{f.dayLabel(`${month}-01`)}</span>
          <span>{f.dayLabel(`${month}-15`)}</span>
          <span>{f.dayLabel(`${month}-${PACE_LAST}`)}</span>
        </div>
        <p className="text-ink-muted mt-1.5 text-[12px]">
          {o.paceBars(f.euro(PACE_THRESHOLD * 100))}
        </p>
      </div>
    </div>
  );
}

/** Screen 3: a dial turns, and the goal card fills to 100 per cent. */
function Goals({ active }: { active: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const { t, locale } = useI18n();
  const w = t.ui.welcome;
  const f = formatter(locale);
  useOnActive(
    active,
    root,
    (el) => {
      const reduced = reducedMotion();
      if (reduced) {
        const d = q<HTMLElement>(el, "[data-dial]");
        if (d) d.style.opacity = String(DIAL_OPACITY);
        const k = q<HTMLElement>(el, "[data-tick]");
        if (k) k.style.opacity = "1";
      }
      return [
        play(
          q(el, "[data-dial]"),
          // It fades in once and stays at its resting strength: no full-strength flash followed by a dimming.
          [
            { transform: "rotate(0deg) scale(.85)", opacity: 0 },
            { transform: "rotate(360deg) scale(1)", opacity: DIAL_OPACITY },
          ],
          { duration: 2000, easing: "cubic-bezier(.45,.05,.2,1)" },
        ),
        play(
          q(el, "[data-goal]"),
          [
            { opacity: 0, transform: "translateY(60px)" },
            { opacity: 0, transform: "translateY(60px)", offset: 0.4 },
            { opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 1500, easing: EASE },
        ),
        play(
          q(el, "[data-tick]"),
          [
            { opacity: 0, transform: "scale(0)" },
            { opacity: 0, transform: "scale(0)", offset: 0.85 },
            { opacity: 1, transform: "scale(1.25)", offset: 0.93 },
            { opacity: 1, transform: "scale(1)" },
          ],
          { delay: 1200, duration: 1500, easing: "ease-out" },
        ),
        // The glow rises slowly with the dial turning, then keeps breathing: no jump at the end of the animation.
        ...glowStops(el, "fromZero"),
        meter(q(el, "[data-m]"), 1, 900, 1700),
        count(q(el, "[data-pct]"), 100, 1700, 900, (v) => `${Math.round(v)}%`),
        count(q(el, "[data-amt]"), 1800, 1700, 900, (v) =>
          w.of(f.euro(Math.round(v) * 100), f.euro(180000)),
        ),
      ];
    },
    [locale],
  );
  const ticks = Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * Math.PI * 2;
    const r1 = i % 6 === 0 ? 74 : 80;
    // Rounded, so the server and the browser print exactly the same numbers.
    const at = (r: number, fn: (x: number) => number) => Math.round((100 + r * fn(a)) * 100) / 100;
    return {
      x1: at(r1, Math.cos),
      y1: at(r1, Math.sin),
      x2: at(88, Math.cos),
      y2: at(88, Math.sin),
      major: i % 6 === 0,
    };
  });
  return (
    <div
      ref={root}
      className="relative grid h-[290px] w-[min(260px,70vw)] -translate-y-7 place-items-center"
    >
      <Glow vault />
      <svg data-dial viewBox="0 0 200 200" className="absolute top-0 size-[200px]" aria-hidden>
        <circle
          cx="100"
          cy="100"
          r="92"
          strokeWidth="2"
          style={{ fill: "var(--glass-bg)", stroke: "var(--glass-border)" }}
        />
        <circle
          cx="100"
          cy="100"
          r="64"
          fill="none"
          strokeWidth="2"
          style={{ stroke: "var(--track)" }}
        />
        {ticks.map((k, i) => (
          <line
            key={i}
            x1={k.x1}
            y1={k.y1}
            x2={k.x2}
            y2={k.y2}
            strokeWidth={k.major ? 3 : 1.5}
            strokeLinecap="round"
            style={{ stroke: "var(--ink-muted)" }}
          />
        ))}
        <circle cx="100" cy="100" r="14" style={{ fill: "var(--ring-accent-from)" }} />
      </svg>
      <div data-goal className="glass absolute bottom-0 grid w-full gap-2.5 p-4">
        <span
          data-tick
          className="absolute top-3.5 right-3.5 grid size-[26px] place-items-center rounded-full text-sm font-bold opacity-0"
          style={{ background: "var(--ring-good-to)", color: "var(--canvas)" }}
          aria-hidden
        >
          ✓
        </span>
        <div>
          <div className="text-ink-muted text-[11.5px] tracking-[.06em] uppercase">{w.goal}</div>
          <div
            data-pct
            className="num text-[26px] leading-none font-semibold tracking-[-0.035em]"
          />
        </div>
        <div className="bg-track h-2 overflow-hidden rounded-full">
          <b
            data-m
            className="block h-full w-full origin-left rounded-full bg-[linear-gradient(90deg,var(--ring-accent-from),var(--ring-accent-to))]"
          />
        </div>
        <span data-amt className="text-ink-muted text-[12.5px]" />
      </div>
    </div>
  );
}

function setCookie(name: string) {
  document.cookie = `${name}=1; path=/; max-age=31536000; samesite=lax`;
}

/** The headline and the text under it rise in softly, one after the other, each time their screen comes into view. */
function Reveal({
  active,
  className,
  children,
}: {
  active: boolean;
  className?: string;
  children: ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!active || !el) return;
    const stops = [...el.children].map((c, i) =>
      play(
        c,
        [
          { opacity: 0, transform: "translateY(14px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { delay: 80 + i * 130, duration: 700, easing: EASE },
      ),
    );
    return () => stops.forEach((stop) => stop());
  }, [active]);
  return (
    <div ref={root} className={className}>
      {children}
    </div>
  );
}

/**
 * TEMPORARY (for testing the introduction on a phone): flips light and dark with one tap. Remove before launch.
 */
function PreviewThemeToggle() {
  const choice = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as const);
  const dark =
    choice === "dark" ||
    (choice === "system" &&
      typeof matchMedia === "function" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button
      type="button"
      onClick={() => applyTheme(dark ? "light" : "dark")}
      className="glass text-ink-muted absolute top-6 left-1/2 z-10 inline-flex min-h-9 -translate-x-1/2 items-center gap-1.5 !rounded-full px-3 text-xs"
    >
      {dark ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
      {dark ? "light" : "dark"} (test)
    </button>
  );
}

/**
 * The three-screen introduction: swipe (or use the dots or the arrow keys), then create an account, or
 * look around with sample data. Works with the theme and the language, and without motion when the
 * device asks for less of it.
 */
export function Onboarding() {
  const router = useRouter();
  const { t } = useI18n();
  const w = t.ui.welcome;
  const [index, setIndex] = useState(0);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; dx: number } | null>(null);
  const last = 2;

  const go = (i: number) => setIndex(Math.max(0, Math.min(last, i)));
  const leave = (to: string, wishSample = false) => {
    setCookie(WELCOMED_COOKIE);
    if (wishSample) setCookie(SAMPLE_WISH_COOKIE);
    router.push(to);
  };

  const onDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("button, a")) return;
    drag.current = { x0: e.clientX, dx: 0 };
    track.current?.setPointerCapture(e.pointerId);
    if (track.current) track.current.style.transition = "none";
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !track.current) return;
    d.dx = e.clientX - d.x0;
    track.current.style.transform = `translateX(calc(${-index * 100}% + ${d.dx}px))`;
  };
  const onEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !track.current) return;
    track.current.style.transition = "";
    track.current.style.transform = `translateX(${-index * 100}%)`;
    if (Math.abs(d.dx) > 50) go(index + (d.dx < 0 ? 1 : -1));
  };

  const screens = [
    { title: w.s1.title, body: w.s1.body, visual: <Hook active={index === 0} /> },
    { title: w.s2.title, body: w.s2.body, visual: <Flow active={index === 1} /> },
    { title: w.s3.title, body: w.s3.body, visual: <Goals active={index === 2} /> },
  ];

  return (
    <div
      className="onb relative min-h-dvh overflow-hidden"
      role="region"
      aria-roledescription="carousel"
      aria-label={w.label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return; // arrows inside the language menu are not for the slides
        if (e.key === "ArrowRight") go(index + 1);
        if (e.key === "ArrowLeft") go(index - 1);
      }}
    >
      {BACKGROUNDS.map((bg, i) => (
        <div
          key={i}
          aria-hidden
          className="absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none"
          style={{ opacity: index === i ? 1 : 0 }}
        >
          {/* Light: the app's own dawn, the same on every screen, so the intro looks like the light app.
              Dark: a different tint per screen, fading into the navy (the dark app is made the same way). */}
          <div className="absolute inset-0 dark:hidden" style={{ background: "var(--page-bg)" }} />
          <div className="absolute inset-0 hidden dark:block" style={{ background: bg }} />
        </div>
      ))}
      <div className="relative mx-auto flex h-dvh min-h-[640px] max-w-[430px] flex-col overflow-hidden">
        <div className="absolute top-5 right-4 left-6 z-10 flex items-center justify-between">
          <span className="num text-ink-muted text-xs tracking-[.08em]">{w.pager(index + 1)}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => go(last)}
              tabIndex={index < last ? 0 : -1}
              aria-hidden={index < last ? undefined : true}
              className={`text-ink-muted min-h-11 px-3 text-sm ${index < last ? "" : "invisible"}`}
            >
              {w.skip}
            </button>
            <LanguageSwitcher />
          </div>
        </div>
        <div
          ref={track}
          className="flex min-h-0 flex-1 touch-pan-y transition-transform duration-[550ms] ease-[cubic-bezier(.3,.8,.3,1)] motion-reduce:transition-none"
          style={{ transform: `translateX(${-index * 100}%)` }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onEnd}
          onPointerCancel={onEnd}
        >
          {screens.map((s, k) => (
            <section
              key={k}
              aria-label={w.screen(k + 1)}
              aria-hidden={index !== k}
              className="grid w-full flex-none grid-rows-[250px_1fr_140px] px-6"
            >
              <Reveal active={index === k} className="grid content-start gap-3 pt-[64px]">
                <h1 className="font-display text-[clamp(40px,12.5vw,52px)] leading-[.98] font-normal tracking-[-0.02em] whitespace-pre-line">
                  {s.title}
                </h1>
                <p className="text-ink-muted max-w-[31ch] text-[15px]">{s.body}</p>
              </Reveal>
              <div
                className={`grid place-items-center transition-transform duration-[550ms] ease-[cubic-bezier(.3,.8,.3,1)] motion-reduce:transition-none ${k === 1 ? "pb-8" : ""}`}
                style={{
                  transform: `translateX(${(k - index) * 60}px)`,
                  // Screen 2 has no buttons, so its content uses the room they would take (down to the dots).
                  gridRow: k === 1 ? "2 / span 2" : undefined,
                }}
              >
                {s.visual}
              </div>
              <div className={k === 1 ? "hidden" : "grid content-end gap-2.5 pb-11"}>
                {k === last && (
                  <>
                    <button
                      type="button"
                      tabIndex={index === last ? 0 : -1}
                      onClick={() => leave("/register")}
                      className="text-ink dark:text-canvas min-h-12 w-full rounded-full px-5 text-base font-semibold shadow-[0_10px_28px_-10px_var(--ring-accent-from)]"
                      style={{ background: "var(--ring-accent-from)" }}
                    >
                      {w.start}
                    </button>
                    <button
                      type="button"
                      tabIndex={index === last ? 0 : -1}
                      onClick={() => leave("/register", true)}
                      className="glass min-h-11 w-full !rounded-full px-5 text-[15px] font-medium"
                    >
                      {w.sample}
                    </button>
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
        <PreviewThemeToggle />
        <div
          className="absolute inset-x-0 bottom-4 z-10 flex justify-center gap-2"
          role="group"
          aria-label={w.label}
        >
          {screens.map((_, k) => (
            <button
              key={k}
              type="button"
              aria-label={w.screen(k + 1)}
              aria-current={index === k}
              onClick={() => go(k)}
              className={`h-[7px] rounded-full transition-all duration-300 ${index === k ? "w-[22px]" : "w-[7px]"}`}
              style={{ background: index === k ? "var(--ring-accent-from)" : "var(--track)" }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
