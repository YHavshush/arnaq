"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A sideways scrolling box for a wide table. On mount it scrolls so the month marked
 * `data-focus-col` sits in the middle of the room left of the sticky first column, which on a
 * phone is what makes this month visible without a swipe. `data-no-swipe` keeps the page's
 * tab swipe out of the way. Focusable so the keyboard can scroll it.
 */
export function TrackerScroll({ label, children }: { label: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    const col = el?.querySelector<HTMLElement>("[data-focus-col]");
    const first = el?.querySelector<HTMLElement>("th");
    if (!el || !col || !first) return;
    const boxRect = el.getBoundingClientRect();
    const c = col.getBoundingClientRect();
    const room = el.clientWidth - first.offsetWidth;
    // Where the column sits inside the scrolled content, then half of the free room before it.
    const left = c.left - boxRect.left + el.scrollLeft;
    el.scrollLeft = Math.max(0, left - first.offsetWidth - (room - c.width) / 2);
  }, []);
  return (
    <div
      ref={box}
      data-no-swipe
      role="region"
      aria-label={label}
      tabIndex={0}
      className="relative overflow-x-auto overscroll-x-contain focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      {children}
    </div>
  );
}
