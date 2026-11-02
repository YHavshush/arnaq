"use client";

import { useLayoutEffect, useRef } from "react";
import { useI18n } from "@/i18n/client";
import { countText, parseCount } from "@/lib/view/count-up";

const DURATION = 800;

/**
 * An amount that counts up from zero once, when the page opens. The server prints the finished text (so nothing is
 * wrong for slow connections, search engines or people who ask for less motion); in the browser the number runs up to
 * it. Only the number moves: the sign, the currency and the spacing are the text exactly as printed. Without motion, or
 * when the text has no number, it simply stays as it is.
 */
export function CountText({ text }: { text: string }) {
  const { locale } = useI18n();
  const el = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = el.current;
    if (!node || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const template = parseCount(text, locale);
    if (!template || template.target === 0) return;
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min((now - start) / DURATION, 1);
      // Fast at first, slow at the end: the last digits settle instead of stopping.
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = countText(template, eased, locale);
      if (p < 1) frame = requestAnimationFrame(step);
    };
    node.textContent = countText(template, 0, locale);
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      node.textContent = text;
    };
    // Counts once per page open: a changed text (the next month) is shown as it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <span ref={el} suppressHydrationWarning>
      {text}
    </span>
  );
}
