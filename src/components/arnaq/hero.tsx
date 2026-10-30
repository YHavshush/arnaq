import type { ReactNode } from "react";
import type { Tone } from "@/design/tokens";
import type { Sentence } from "@/lib/view/overzicht";
import { Ring } from "./ring";
import { SentenceText } from "./sentence";

interface HeroProps {
  tone: Tone;
  value: number;
  ringLabel: string;
  /** The one big number. */
  centre: ReactNode;
  /** Small line under the number, inside the ring. */
  caption: string;
  sentence: Sentence;
  /** A short paragraph under the sentence that explains it (optional). */
  detail?: ReactNode;
  /** Small lines under the detail (optional): what is over, under, or still to come. */
  facts?: string[];
}

/** Room for the number inside the ring (px) and the widest a character gets (em); see `numberSize`. */
const NUMBER_ROOM = 168;
const CHAR_EM = 0.5; // measured: the digits and the currency sign average about 0.47em
const NUMBER_MAX = 52;

/** Largest font size (px) at which a number of `chars` characters still fits inside the ring. */
export function numberSize(chars: number): number {
  return Math.min(NUMBER_MAX, Math.floor(NUMBER_ROOM / (CHAR_EM * Math.max(chars, 1))));
}

/**
 * The pattern every screen opens with: ring, one number, one sentence. No card behind it.
 * Phone: stacked and centred. Laptop (app width 900px or more): the ring on the left, the sentence
 * and its explanation on the right, as in the design.
 */
export function Hero({
  tone,
  value,
  ringLabel,
  centre,
  caption,
  sentence,
  detail,
  facts,
}: HeroProps) {
  return (
    <section className="flex flex-col items-center gap-5 pt-2 pb-2 text-center @min-[900px]/app:flex-row @min-[900px]/app:gap-12 @min-[900px]/app:text-left">
      <Ring value={value} tone={tone} label={ringLabel}>
        <div
          className="num leading-none font-medium tracking-[-0.035em] whitespace-nowrap dark:font-normal"
          style={{ fontSize: typeof centre === "string" ? numberSize(centre.length) : NUMBER_MAX }}
        >
          {centre}
        </div>
        <div className="text-ink-muted mt-2 text-sm">{caption}</div>
      </Ring>
      <div className="grid gap-3 @min-[900px]/app:max-w-[40ch]">
        <p className="font-display max-w-[34ch] text-[26px] leading-[1.2] text-balance @min-[900px]/app:text-[32px]">
          <SentenceText parts={sentence} />
        </p>
        {detail ? (
          <p className="text-ink-muted max-w-[52ch] text-[15px] leading-snug">{detail}</p>
        ) : null}
        {facts && facts.length > 0 ? (
          <ul className="text-ink-muted grid max-w-[52ch] gap-1 text-[14px] leading-snug">
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
