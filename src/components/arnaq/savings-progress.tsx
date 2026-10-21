import { Check } from "lucide-react";
import type { Tone } from "@/design/tokens";

const DOT: Record<Tone, string> = {
  accent: "var(--ring-accent-to)",
  good: "var(--ring-good-to)",
  warn: "var(--ring-warn-to)",
  bad: "var(--ring-bad-to)",
};

/**
 * The savings goal as a card: how far along in per cent, a progress bar, the amounts, and a tick once it
 * is reached. The same look as the card in the introduction. Status stays in words ("Under way",
 * "Reached"); the dot or tick only backs it up.
 */
export function SavingsProgress({
  label,
  word,
  sub,
  saved,
  target,
  tone,
  className = "",
}: {
  label: string;
  word: string;
  sub: string;
  /** Cents saved and the goal (cents); the per cent is worked out here and never goes below 0 or above 100. */
  saved: number;
  target: number;
  tone: Tone;
  className?: string;
}) {
  const pct = target > 0 ? Math.max(0, Math.min(100, Math.round((saved / target) * 100))) : 0;
  const reached = saved >= target;
  const from = reached ? "var(--ring-good-from)" : "var(--ring-accent-from)";
  const to = reached ? "var(--ring-good-to)" : "var(--ring-accent-to)";
  return (
    <div className={`glass grid gap-2.5 p-4 ${className}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-ink-muted text-[13px]">{label}</div>
          <div className="num text-[30px] leading-none font-semibold tracking-[-0.035em]">
            {pct}%
          </div>
        </div>
        <div className="flex items-center gap-2 pt-0.5 text-[15px] font-semibold">
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
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="bg-track h-2 overflow-hidden rounded-full"
      >
        <i
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, background: `linear-gradient(90deg, ${from}, ${to})` }}
        />
      </div>
      <div className="text-ink-muted text-[13px]">{sub}</div>
    </div>
  );
}
