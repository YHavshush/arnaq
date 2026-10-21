"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { TAB_EVENT, TAB_HREFS, tabIndexOf } from "./tabs";

const EASE = "cubic-bezier(.2,.8,.2,1)";
const reducedMotion = () =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** A touch that starts here must stay with the element: a sideways swipe inside it means something else. */
function claimsSideways(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      "input, textarea, select, [contenteditable], [role=slider], [data-no-swipe], nav, dialog",
    )
  )
    return true;
  for (let n: Element | null = target; n && n !== document.body; n = n.parentElement) {
    const { overflowX } = getComputedStyle(n);
    if ((overflowX === "auto" || overflowX === "scroll") && n.scrollWidth > n.clientWidth + 1)
      return true;
  }
  return false;
}

/**
 * Moves between the main tabs like a feed app does.
 * - A new page slides and fades in from the side it lies on (right for a later tab, left for an earlier one).
 * - On a phone, a sideways swipe moves to the next or previous tab: the page follows the finger, and a long or quick
 *   enough swipe goes on to the tab (a swipe past the first or last tab just stretches and springs back).
 * Left alone: swipes that start at the screen's edges (the browser's back gesture), inside things that scroll
 * sideways, in inputs, on the bar, or while a sheet is open. Vertical scrolling is never touched.
 */
export function PageMotion({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const pathNow = useRef(path);
  const before = useRef(path);
  const hint = useRef(0); // the side a swipe chose, for the page that arrives
  const giveUp = useRef(0);

  // A new page: slide and fade it in from the side it lies on.
  useLayoutEffect(() => {
    pathNow.current = path;
    if (before.current === path) return;
    const from = tabIndexOf(before.current);
    const to = tabIndexOf(path);
    before.current = path;
    window.clearTimeout(giveUp.current);
    const el = box.current;
    if (!el) return;
    el.style.transition = "";
    el.style.transform = "";
    el.style.opacity = "";
    const side = from >= 0 && to >= 0 ? Math.sign(to - from) : hint.current;
    hint.current = 0;
    if (reducedMotion()) return;
    el.animate(
      [
        { opacity: 0, transform: side ? `translateX(${side * 32}px)` : "translateY(10px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 320, easing: EASE },
    );
  }, [path]);

  // Swiping between tabs.
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)");
    let s: { x: number; y: number; t: number; tab: number; live: boolean } | null = null;
    const el = () => box.current;

    const start = (e: TouchEvent) => {
      s = null;
      const tab = tabIndexOf(pathNow.current);
      const f = e.touches[0];
      if (e.touches.length !== 1 || tab < 0 || wide.matches || !el()) return;
      if (f.clientX < 24 || f.clientX > window.innerWidth - 24) return;
      if (claimsSideways(e.target)) return;
      s = { x: f.clientX, y: f.clientY, t: performance.now(), tab, live: false };
    };

    const move = (e: TouchEvent) => {
      const box = el();
      if (!s || !box) return;
      const f = e.touches[0];
      const dx = f.clientX - s.x;
      const dy = f.clientY - s.y;
      if (!s.live) {
        if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.6) {
          s = null; // mostly vertical: that is scrolling
          return;
        }
        s.live = true;
        box.style.transition = "none";
      }
      const next = s.tab + (dx < 0 ? 1 : -1);
      const exists = next >= 0 && next < TAB_HREFS.length;
      const x = Math.max(-140, Math.min(140, dx * (exists ? 0.5 : 0.18)));
      box.style.transform = `translateX(${x}px)`;
      box.style.opacity = String(1 - (Math.abs(x) / 140) * 0.4);
    };

    const end = (e: TouchEvent) => {
      const box = el();
      const t = s;
      s = null;
      if (!t?.live || !box) return;
      const f = e.changedTouches[0];
      const dx = f.clientX - t.x;
      const speed = Math.abs(dx) / Math.max(1, performance.now() - t.t);
      const next = t.tab + (dx < 0 ? 1 : -1);
      const go =
        e.type === "touchend" &&
        next >= 0 &&
        next < TAB_HREFS.length &&
        (Math.abs(dx) > 70 || (speed > 0.5 && Math.abs(dx) > 30));
      box.style.transition = `transform 200ms ${EASE}, opacity 200ms`;
      if (go) {
        // Step aside and go; the page that arrives slides in from the other side (see above).
        hint.current = dx < 0 ? 1 : -1;
        box.style.transform = `translateX(${dx < 0 ? -48 : 48}px)`;
        box.style.opacity = "0.5";
        window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: TAB_HREFS[next] }));
        router.push(TAB_HREFS[next]);
        // If the next page never arrives, settle back rather than stay stepped aside.
        giveUp.current = window.setTimeout(() => {
          box.style.transform = "";
          box.style.opacity = "";
        }, 5000);
      } else {
        box.style.transform = "";
        box.style.opacity = "";
        window.setTimeout(() => {
          if (box.style.transition.includes("200ms")) box.style.transition = "";
        }, 220);
      }
    };

    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: true });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
      window.clearTimeout(giveUp.current);
    };
  }, [router]);

  return <div ref={box}>{children}</div>;
}
