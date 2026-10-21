"use client";

import { Repeat, TrendingUp, Upload, WalletCards, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { Wordmark } from "./logo";
import { TAB_EVENT, isTabActive } from "./tabs";

const ITEMS: {
  href: string;
  key: "overview" | "forecast" | "fixedCosts" | "upload";
  icon: LucideIcon;
}[] = [
  { href: "/", key: "overview", icon: WalletCards },
  { href: "/forecast", key: "forecast", icon: TrendingUp },
  { href: "/fixed-costs", key: "fixedCosts", icon: Repeat },
  { href: "/upload", key: "upload", icon: Upload },
];

const isActive = isTabActive;

/** A little overshoot at the end, so the pill settles into place instead of just stopping. */
const SPRING = "cubic-bezier(.3,1.35,.5,1)";

const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * True while the page is being scrolled down (past the top), false on the way back up and near the top.
 * The nav uses it to shrink out of the way while someone reads, and to come back as soon as they scroll up.
 */
function useCompactOnScroll() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    let raf = 0;
    const update = () => {
      raf = 0;
      const y = window.scrollY;
      const dy = y - last;
      if (y < 48) {
        setCompact(false);
        last = y;
      } else if (dy > 10) {
        setCompact(true);
        last = y;
      } else if (dy < -10) {
        setCompact(false);
        last = y;
      }
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return compact;
}

/** Sidebar on a wide app, floating pill on a narrow one. `badge` goes on Upload (open items). */
export function Nav({ badge }: { badge?: ReactNode }) {
  const path = usePathname();
  const { t } = useI18n();
  const compact = useCompactOnScroll();
  const navRef = useRef<HTMLElement>(null);
  // While a finger is down on the bar the selected bubble swells, like a lens, and settles when it lifts.
  const [pressed, setPressed] = useState(false);

  // The pill moves the moment a tab is tapped, not when the next page has loaded. `from` ties the tap to the page it
  // was made on, so it stops counting by itself as soon as the route has changed (or if the navigation never happens).
  const [tap, setTap] = useState<{ href: string; from: string } | null>(null);
  useEffect(() => {
    const onSwipe = (e: Event) => setTap({ href: (e as CustomEvent<string>).detail, from: path });
    window.addEventListener(TAB_EVENT, onSwipe);
    return () => window.removeEventListener(TAB_EVENT, onSwipe);
  }, [path]);
  useEffect(() => {
    if (!tap) return;
    const id = setTimeout(() => setTap(null), 5000);
    return () => clearTimeout(id);
  }, [tap]);
  const current = ITEMS.find((i) => isActive(path, i.href))?.href ?? null;
  const shown = tap && tap.from === path ? tap.href : current;
  const index = ITEMS.findIndex((i) => i.href === shown);

  // Animations beyond the slide: the pill stretches a little on its way, the new tab's icon hops. The slide's own
  // transition is switched on after the first paint, so the pill is simply there on load instead of sliding in.
  const before = useRef(shown);
  useEffect(() => {
    const pill = navRef.current?.querySelector<HTMLElement>("[data-pill]");
    if (pill && !reducedMotion())
      pill.style.transition = `transform 460ms ${SPRING}, opacity 200ms`;
  }, []);
  useEffect(() => {
    if (before.current === shown) return;
    before.current = shown;
    const nav = navRef.current;
    if (!nav || reducedMotion()) return;
    nav
      .querySelector("[data-pill-body]")
      ?.animate(
        [
          { transform: "scaleX(1)" },
          { transform: "scaleX(1.24)", offset: 0.4 },
          { transform: "scaleX(1)" },
        ],
        { duration: 460, easing: "ease-in-out" },
      );
    nav
      .querySelector(`[data-icon="${shown}"]`)
      ?.animate(
        [
          { transform: "translateY(0) scale(1)" },
          { transform: "translateY(-3px) scale(1.16)", offset: 0.4 },
          { transform: "translateY(0) scale(1)" },
        ],
        { duration: 440, easing: SPRING },
      );
  }, [shown]);

  return (
    <>
      <nav
        ref={navRef}
        data-compact={compact}
        data-pressed={pressed}
        onPointerDown={() => setPressed(true)}
        onPointerUp={() => setPressed(false)}
        onPointerCancel={() => setPressed(false)}
        onPointerLeave={() => setPressed(false)}
        aria-label={t.ui.nav.label}
        className="liquid group/nav fixed bottom-[calc(12px+env(safe-area-inset-bottom,0px))] left-1/2 z-20 grid w-[min(440px,calc(100%-24px))] -translate-x-1/2 grid-cols-4 rounded-full p-1.5 transition-[width] duration-300 ease-out data-[compact=true]:w-[min(320px,calc(100%-24px))] motion-reduce:transition-none @min-[900px]/app:hidden"
      >
        <span
          aria-hidden
          data-pill
          className="pointer-events-none absolute top-1.5 bottom-1.5 left-1.5 w-[calc((100%-12px)/4)]"
          style={{
            transform: `translateX(${Math.max(index, 0) * 100}%)`,
            opacity: index < 0 ? 0 : 1,
          }}
        >
          <span data-pill-lens className="block h-full">
            <span
              data-pill-body
              className="bg-accent block h-full rounded-full bg-[linear-gradient(180deg,rgb(255_255_255/.24),transparent_55%)] shadow-[inset_0_1px_1px_rgb(255_255_255/.5),inset_0_-2px_5px_rgb(0_0_0/.14),0_8px_16px_-8px_var(--accent)]"
            />
          </span>
        </span>
        {ITEMS.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(path, href) ? "page" : undefined}
            onClick={() => setTap({ href, from: path })}
            className={`relative z-10 grid min-h-12 content-center justify-items-center gap-0.5 rounded-full px-1 py-1.5 text-[11.5px] font-semibold transition-[transform,color,min-height,gap] duration-200 group-data-[compact=true]/nav:min-h-10 group-data-[compact=true]/nav:gap-0 active:scale-[.92] motion-reduce:transition-none ${
              shown === href ? "text-accent-ink" : "text-ink-muted"
            }`}
          >
            <Icon data-icon={href} className="size-5" />
            <span className="max-h-4 overflow-hidden leading-4 transition-[max-height,opacity] duration-200 group-data-[compact=true]/nav:max-h-0 group-data-[compact=true]/nav:opacity-0 motion-reduce:transition-none">
              {t.ui.nav[key]}
            </span>
            {href === "/upload" && badge}
          </Link>
        ))}
      </nav>
      <aside className="glass-nav sticky top-0 hidden h-dvh flex-col gap-1 self-start border-y-0 border-s-0 px-3 py-5 @min-[900px]/app:flex">
        <div className="px-3 pb-5">
          <Wordmark title={t.ui.brand} className="h-6 w-auto" />
        </div>
        {ITEMS.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(path, href) ? "page" : undefined}
            className="text-ink-muted hover:bg-soft aria-[current=page]:bg-soft aria-[current=page]:text-accent flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium"
          >
            <Icon className="size-[18px]" />
            {t.ui.nav[key]}
            {href === "/upload" && badge}
          </Link>
        ))}
      </aside>
    </>
  );
}
