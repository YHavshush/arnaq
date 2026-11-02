"use client";

import { ChevronsRight } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { slideKey, slideProgress, slideReached } from "@/lib/client/slide";

const HANDLE = 44;
const GAP = 4;

/**
 * Slide the handle all the way across to confirm. For things that cannot be undone, on a phone, where a second tap is
 * too easy to do by accident. Drag it across; let go early and it goes back. It is also a slider for the keyboard and
 * for a screen reader (arrow keys or the adjust gesture, in four steps; Enter alone does nothing). Only transform moves,
 * and without motion the handle just jumps.
 */
export function SlideToConfirm({
  label,
  onConfirm,
  disabled = false,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
}) {
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x0: number; room: number } | null>(null);
  const [progress, setProgress] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [sent, setSent] = useState(false);

  const room = () => Math.max((track.current?.clientWidth ?? 0) - HANDLE - GAP * 2, 0);

  function finish(p: number) {
    if (slideReached(p)) {
      setProgress(1);
      setSent(true);
      onConfirm();
    } else setProgress(0);
  }

  // After a confirm the slide comes back, so a failed action (an error shown by the parent) can be tried again.
  useEffect(() => {
    if (!sent) return;
    const id = setTimeout(() => {
      setSent(false);
      setProgress(0);
    }, 900);
    return () => clearTimeout(id);
  }, [sent]);

  return (
    <div
      ref={track}
      className={`relative h-[52px] w-full overflow-hidden rounded-full select-none ${disabled ? "opacity-50" : ""}`}
      style={
        {
          background: "color-mix(in oklab, var(--bad) 14%, transparent)",
          // The track's own width drives the layout (100cqw), so nothing has to be measured while drawing.
          containerType: "inline-size",
          "--p": progress,
        } as CSSProperties
      }
    >
      <div
        aria-hidden
        className="absolute inset-y-0 left-0 rounded-full"
        style={{
          width: `calc(${GAP + HANDLE}px + var(--p) * (100cqw - ${HANDLE + GAP * 2}px))`,
          background: "color-mix(in oklab, var(--bad) 24%, transparent)",
          transition: dragging ? "none" : undefined,
        }}
      />
      <span
        aria-hidden
        className="text-ink-muted pointer-events-none absolute inset-0 grid place-items-center pl-8 text-[15px] font-semibold"
        style={{ opacity: 1 - progress }}
      >
        {label}
      </span>
      <div
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progress * 100)}
        aria-disabled={disabled}
        onPointerDown={(e) => {
          if (disabled || sent) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { x0: e.clientX, room: room() };
          setDragging(true);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d) setProgress(slideProgress(e.clientX - d.x0, d.room));
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          setDragging(false);
          if (d) finish(slideProgress(e.clientX - d.x0, d.room));
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
          setProgress(0);
        }}
        onKeyDown={(e) => {
          if (disabled || sent) return;
          const next = slideKey(e.key, progress);
          if (next === null) return;
          e.preventDefault();
          if (next === 1) finish(1);
          else setProgress(next);
        }}
        className="bg-bad text-canvas focus-visible:ring-ink absolute top-1 left-1 grid size-11 touch-none place-items-center rounded-full outline-none focus-visible:ring-2"
        style={{
          transform: `translateX(calc(var(--p) * (100cqw - ${HANDLE + GAP * 2}px)))`,
          transition: dragging ? "none" : "transform 0.25s cubic-bezier(.2,.8,.2,1)",
        }}
      >
        <ChevronsRight aria-hidden className="size-5" />
      </div>
    </div>
  );
}

/**
 * The slide on a touch screen, and the ordinary button (`children`) everywhere else (a laptop, a mouse). Both are in the
 * page and CSS shows the right one, so nothing flashes and a keyboard on a laptop still gets a plain button.
 */
export function SlideOrButton({
  label,
  onConfirm,
  disabled,
  children,
}: {
  label: string;
  onConfirm: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <>
      <div className="hidden w-full [@media(pointer:coarse)]:block">
        <SlideToConfirm label={label} onConfirm={onConfirm} disabled={disabled} />
      </div>
      <div className="[@media(pointer:coarse)]:hidden">{children}</div>
    </>
  );
}
