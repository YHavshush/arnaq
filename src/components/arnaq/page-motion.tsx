"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { EDGE, flickSpeed, lockAxis, pagePosition, shouldCommit } from "@/lib/client/pager";
import { TAB_EVENT, TAB_HREFS, tabIndexOf } from "./tabs";

/** A spring that settles fast and does not bounce, like the system pagers. */
const SPRING = "cubic-bezier(.22,.9,.28,1)";
const OUT_MS = 170;
const IN_MS = 300;
const BACK_MS = 260;
const EASE = SPRING;
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
 * Moves between the main tabs like a phone's own pager (Instagram, the system tab views).
 * - On a phone, a sideways swipe moves the page one to one with the finger. Let go past a third of the screen, or with a
 *   quick flick, and it slides off while the next tab slides in from the other side; otherwise it springs back. At the
 *   first and last tab it resists. The rules are in `src/lib/client/pager.ts`.
 * - Tapping a tab in the bar fades the new page in softly, without a slide.
 * Left alone: touches that start at the screen's edges (the browser's back gesture), inside things that scroll sideways,
 * in inputs, on the bar, or while a sheet is open. A mostly vertical move is scrolling and is never touched.
 */
export function PageMotion({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const pathNow = useRef(path);
  const before = useRef(path);
  const hint = useRef(0); // the side a swipe chose: +1 the next tab (arrives from the right), -1 the one before
  const giveUp = useRef(0);

  // A new page arrives.
  useLayoutEffect(() => {
    pathNow.current = path;
    if (before.current === path) return;
    const from = tabIndexOf(before.current);
    const to = tabIndexOf(path);
    before.current = path;
    window.clearTimeout(giveUp.current);
    const el = box.current;
    if (!el) return;
    const swiped = hint.current;
    hint.current = 0;
    el.style.transition = "";
    el.style.transform = "";
    el.style.opacity = "";
    el.style.willChange = "";
    if (reducedMotion()) return;
    if (swiped !== 0) {
      // After a swipe the new page takes the place of the old one from the side it lies on.
      el.animate([{ transform: `translateX(${swiped * 100}%)` }, { transform: "translateX(0)" }], {
        duration: IN_MS,
        easing: EASE,
      });
      return;
    }
    const side = from >= 0 && to >= 0 ? Math.sign(to - from) : 0;
    el.animate(
      [
        { opacity: 0, transform: side ? `translateX(${side * 24}px)` : "translateY(10px)" },
        { opacity: 1, transform: "none" },
      ],
      { duration: 280, easing: EASE },
    );
  }, [path]);

  // Swiping between tabs.
  useEffect(() => {
    const wide = matchMedia("(min-width: 900px)");
    type Touch = {
      x: number;
      y: number;
      tab: number;
      axis: "pending" | "horizontal" | "vertical";
      samples: { x: number; t: number }[];
    };
    let s: Touch | null = null;
    const el = () => box.current;

    const start = (e: TouchEvent) => {
      s = null;
      const tab = tabIndexOf(pathNow.current);
      const f = e.touches[0];
      if (e.touches.length !== 1 || tab < 0 || wide.matches || !el()) return;
      if (f.clientX < EDGE || f.clientX > window.innerWidth - EDGE) return;
      if (claimsSideways(e.target)) return;
      s = {
        x: f.clientX,
        y: f.clientY,
        tab,
        axis: "pending",
        samples: [{ x: f.clientX, t: performance.now() }],
      };
    };

    const move = (e: TouchEvent) => {
      const box = el();
      if (!s || !box || s.axis === "vertical") return;
      const f = e.touches[0];
      const dx = f.clientX - s.x;
      const dy = f.clientY - s.y;
      if (s.axis === "pending") {
        const axis = lockAxis(dx, dy);
        if (axis === "pending") return;
        s.axis = axis;
        if (axis === "vertical") return; // scrolling: leave it alone
        box.style.transition = "none";
        box.style.willChange = "transform";
      }
      // The page is ours now: stop the browser from also scrolling or bouncing while the finger moves sideways.
      if (e.cancelable) e.preventDefault();
      s.samples.push({ x: f.clientX, t: performance.now() });
      if (s.samples.length > 12) s.samples.shift();
      const next = s.tab + (dx < 0 ? 1 : -1);
      const hasNext = next >= 0 && next < TAB_HREFS.length;
      box.style.transform = `translateX(${pagePosition(dx, hasNext)}px)`;
    };

    const end = (e: TouchEvent) => {
      const box = el();
      const t = s;
      s = null;
      if (!t || t.axis !== "horizontal" || !box) return;
      const f = e.changedTouches[0];
      const dx = f.clientX - t.x;
      const next = t.tab + (dx < 0 ? 1 : -1);
      const hasNext = next >= 0 && next < TAB_HREFS.length;
      const go =
        e.type === "touchend" &&
        shouldCommit({
          dx,
          speed: flickSpeed(t.samples, performance.now()),
          width: window.innerWidth,
          hasNext,
        });
      if (go) {
        // Slide off in the direction of the swipe; the next page slides in from the other side (see above).
        const side = dx < 0 ? 1 : -1;
        hint.current = side;
        box.style.transition = `transform ${OUT_MS}ms ${EASE}`;
        box.style.transform = `translateX(${-side * 100}%)`;
        window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail: TAB_HREFS[next] }));
        router.push(TAB_HREFS[next]);
        // If the next page never arrives, come back rather than stay out of sight.
        giveUp.current = window.setTimeout(() => {
          hint.current = 0;
          box.style.transition = `transform ${BACK_MS}ms ${EASE}`;
          box.style.transform = "";
        }, 4000);
      } else {
        box.style.transition = `transform ${BACK_MS}ms ${EASE}`;
        box.style.transform = "";
        window.setTimeout(() => {
          if (box.style.transition.includes(`${BACK_MS}ms`)) {
            box.style.transition = "";
            box.style.willChange = "";
          }
        }, BACK_MS + 20);
      }
    };

    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
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
