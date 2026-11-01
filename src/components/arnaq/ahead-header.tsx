import type { Sentence } from "@/lib/view/overzicht";
import { SentenceText } from "./sentence";

/**
 * The top of Ahead, without a ring: what the number is, the number, how far it moves, and the story in a sentence.
 * The chart under it carries the rest.
 */
export function AheadHeader({
  label,
  amount,
  pill,
  sentence,
  detail,
}: {
  /** What the number is ("net worth by Apr"). */
  label: string;
  amount: string;
  /** How far it moves, with its tone; left out when there is nothing honest to say. */
  pill?: { text: string; good: boolean };
  sentence: Sentence;
  detail?: string | null;
}) {
  return (
    <section className="grid max-w-[52ch] gap-2 pt-2 pb-4">
      <div className="text-ink-muted text-sm">{label}</div>
      <div className="num font-display text-[48px] leading-none font-medium tracking-[-0.02em] dark:font-normal">
        {amount}
      </div>
      {pill && (
        <div>
          <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-sm leading-none font-semibold ${pill.good ? "text-good" : "text-bad"}`}
            style={{ background: "color-mix(in oklab, currentColor 14%, transparent)" }}
          >
            {pill.text}
          </span>
        </div>
      )}
      <p className="font-display text-[24px] leading-[1.2] text-balance">
        <SentenceText parts={sentence} />
      </p>
      {detail ? <p className="text-ink-muted text-[15px] leading-snug">{detail}</p> : null}
    </section>
  );
}
