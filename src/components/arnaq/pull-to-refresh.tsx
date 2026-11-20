"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import { syncBanks } from "@/lib/client/bank-sync";
import { useToast } from "./toast";

/** The screens that show the numbers; the pull to fetch lives on these. */
const PAGES = new Set(["/", "/forecast"]);
/** How far the indicator has to come down (px, after damping) before letting go fetches. */
const THRESHOLD = 56;
const MAX = 96;
const DAMPING = 0.5;
/** A touch that starts here is not a pull: it belongs to the element. */
const OWN_TOUCH =
  "input, textarea, select, [contenteditable], [role=slider], [data-no-swipe], nav, dialog";

/**
 * Pull down from the top of Today or Ahead to fetch the newest transactions from the linked banks (an installed app has
 * no pull to refresh of its own). Only mounted while a bank is linked. It asks the same question as "Refresh now" in
 * Settings, which stays there for a computer, and says how it went in a toast. A sideways or upward move, a touch that
 * starts inside a field, the bar or a sheet, or a page that is not at its top, is left to the page.
 */
export function PullToRefresh() {
  const path = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { toast } = useToast();
  const s = t.ui.banking;
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const pullNow = useRef(0);
  const busyNow = useRef(false);
  const touch = useRef<{ x: number; y: number; decided: boolean } | null>(null);
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    if (!PAGES.has(path)) return;
    const show = (v: number) => {
      pullNow.current = v;
      setPull(v);
    };

    async function fetchBanks() {
      busyNow.current = true;
      setBusy(true);
      show(THRESHOLD);
      const outcome = await syncBanks(s);
      toast(outcome.error ?? outcome.problems[0] ?? outcome.message ?? s.refreshed(0));
      router.refresh();
      busyNow.current = false;
      setBusy(false);
      show(0);
    }

    function start(e: TouchEvent) {
      const target = e.target;
      const blocked = target instanceof Element && target.closest(OWN_TOUCH) !== null;
      touch.current =
        busyNow.current || e.touches.length !== 1 || window.scrollY > 0 || blocked
          ? null
          : { x: e.touches[0].clientX, y: e.touches[0].clientY, decided: false };
    }

    function move(e: TouchEvent) {
      const m = touch.current;
      if (!m) return;
      const dy = e.touches[0].clientY - m.y;
      const dx = e.touches[0].clientX - m.x;
      if (!m.decided) {
        if (Math.abs(dy) < 8 && Math.abs(dx) < 8) return;
        m.decided = true;
        // Only a clearly downward move from the very top is a pull; anything else is the page's own.
        if (!(dy > 0 && Math.abs(dy) > Math.abs(dx) * 1.3 && window.scrollY <= 0)) {
          touch.current = null;
          return;
        }
        setDrag(true);
      }
      if (e.cancelable) e.preventDefault(); // hold the page still while the indicator follows the finger
      show(Math.max(0, Math.min(MAX, dy * DAMPING)));
    }

    function end() {
      if (!touch.current) return;
      touch.current = null;
      setDrag(false);
      if (pullNow.current >= THRESHOLD && !busyNow.current) void fetchBanks();
      else show(0);
    }

    document.addEventListener("touchstart", start, { passive: true });
    document.addEventListener("touchmove", move, { passive: false });
    document.addEventListener("touchend", end);
    document.addEventListener("touchcancel", end);
    return () => {
      document.removeEventListener("touchstart", start);
      document.removeEventListener("touchmove", move);
      document.removeEventListener("touchend", end);
      document.removeEventListener("touchcancel", end);
    };
  }, [path, router, s, toast]);

  if (!PAGES.has(path) || (pull === 0 && !busy)) return null;
  const label = busy ? s.fetching : pull >= THRESHOLD ? s.pullRelease : s.pullHint;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.5rem)] z-40 flex justify-center"
      style={{
        transform: `translateY(${Math.max(pull - 36, -36)}px)`,
        opacity: Math.min(1, pull / THRESHOLD),
        transition: drag ? "none" : "transform 200ms ease, opacity 200ms ease",
      }}
    >
      <span className="glass rounded-full px-4 py-2 text-[14px] font-semibold">{label}</span>
    </div>
  );
}
