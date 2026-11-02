import type { ReactNode } from "react";
import type { Tone } from "@/design/tokens";
import type { Sentence } from "@/lib/view/overzicht";
import { Ring } from "./ring";
import { SentenceText } from "./sentence";

/**
 * The top of Ahead. The ring holds the number; the sentence, the change and the small facts sit next to it on a laptop
 * (container 900px or wider) and under it on a phone. `children` is the row of where the money is and the BTW note.
 */
export function AheadTop({
  tone,
  value,
  ringLabel,
  amount,
  caption,
  pill,
  ringNote,
  sentence,
  detail,
  children,
}: {
  tone: Tone;
  /** The arc, 0..1. */
  value: number;
  ringLabel: string;
  amount: string;
  /** What the number is ("net worth by Apr"). */
  caption: string;
  /** How far it moves, with its tone; left out when there is nothing honest to say. */
  pill?: { text: string; good: boolean };
  /** One line that says what the arc means; left out when the pill says it. */
  ringNote?: string;
  sentence: Sentence;
  detail?: string | null;
  children?: ReactNode;
}) {
  return (
    <section className="grid gap-5 pt-2 pb-5 @min-[900px]/app:grid-cols-[auto_minmax(0,1fr)] @min-[900px]/app:items-center @min-[900px]/app:gap-12">
      <div className="flex justify-center @min-[900px]/app:justify-start">
        <Ring value={value} tone={tone} label={ringLabel}>
          <div className="num text-[34px] leading-none font-medium tracking-[-0.03em] whitespace-nowrap dark:font-normal">
            {amount}
          </div>
          <div className="text-ink-muted mt-2 max-w-[9rem] text-xs leading-tight">{caption}</div>
        </Ring>
      </div>
      <div className="grid gap-3 text-center @min-[900px]/app:text-left">
        <p className="font-display text-[24px] leading-[1.2] text-balance @min-[900px]/app:text-[30px]">
          <SentenceText parts={sentence} />
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 @min-[900px]/app:justify-start">
          {pill && (
            <span
              className={`inline-flex items-center rounded-full px-3 py-1 text-sm leading-none font-semibold ${pill.good ? "text-good" : "text-bad"}`}
              style={{ background: "color-mix(in oklab, currentColor 14%, transparent)" }}
            >
              {pill.text}
            </span>
          )}
          {ringNote ? <span className="text-ink-muted text-[13px]">{ringNote}</span> : null}
        </div>
        {detail ? <p className="text-ink-muted text-[15px] leading-snug">{detail}</p> : null}
        {children}
      </div>
    </section>
  );
}
