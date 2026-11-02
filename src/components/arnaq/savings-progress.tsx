import { Check } from "lucide-react";
import type { Tone } from "@/design/tokens";
import { tankLevel } from "@/lib/view/savings-tank";
import { SavingsTank } from "./savings-tank";

const DOT: Record<Tone, string> = {
  accent: "var(--ring-accent-to)",
  good: "var(--ring-good-to)",
  warn: "var(--ring-warn-to)",
  bad: "var(--ring-bad-to)",
};

/**
 * The savings goal as a tank that fills to how far along you are, with the per cent, the status in words ("Under
 * way", "Reached"; the dot or tick only backs it up) and the amounts. `tile` is the small one on Today (an upright tank
 * on the right); `card` is the big one in Settings (the tank on the left, with how much is still to go).
 */
export function SavingsProgress({
  label,
  word,
  sub,
  saved,
  target,
  tone,
  variant = "tile",
  toGo,
  className = "",
}: {
  label: string;
  word: string;
  sub: string;
  /** Cents saved and the goal (cents); the per cent is worked out here and never goes below 0 or above 100. */
  saved: number;
  target: number;
  tone: Tone;
  variant?: "tile" | "card";
  /** "€2,900 to go": the `card` shows it under the amounts; left out once the goal is reached. */
  toGo?: string;
  className?: string;
}) {
  const { pct, level, reached } = tankLevel(saved, target);
  const status = (
    <div className="flex items-center gap-2 text-[15px] font-semibold">
      {reached ? (
        <span
          aria-hidden
          className="grid size-[22px] place-items-center rounded-full"
          style={{ background: "var(--ring-good-to)", color: "var(--canvas)" }}
        >
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      ) : (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ background: DOT[tone] }}
        />
      )}
      {word}
    </div>
  );
  // The tank is a picture; this is what a screen reader gets as the progress.
  const progress = (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="sr-only"
    />
  );
  if (variant === "card")
    return (
      <div className={`glass flex items-center gap-5 p-4 ${className}`}>
        <SavingsTank level={level} reached={reached} size="lg" />
        <div className="grid min-w-0 gap-1.5">
          <div className="text-ink-muted text-[13px]">{label}</div>
          <div className="num text-[38px] leading-none font-semibold tracking-[-0.035em]">
            {pct}%
          </div>
          {status}
          <div className="text-ink-muted text-[13px]">{sub}</div>
          {toGo && !reached ? <div className="text-ink-muted text-[13px]">{toGo}</div> : null}
        </div>
        {progress}
      </div>
    );
  return (
    <div className={`glass grid gap-2 p-4 ${className}`}>
      <div className="text-ink-muted text-[13px]">{label}</div>
      <div className="flex items-center gap-4">
        <div className="grid min-w-0 gap-1.5">
          <div className="num text-[30px] leading-none font-semibold tracking-[-0.035em]">
            {pct}%
          </div>
          {status}
          <div className="text-ink-muted text-[13px]">{sub}</div>
        </div>
        <SavingsTank level={level} reached={reached} className="ml-auto" />
      </div>
      {progress}
    </div>
  );
}
