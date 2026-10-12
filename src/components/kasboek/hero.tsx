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
}

/** Room for the number inside the ring (px) and the widest a character gets (em); see `numberSize`. */
const NUMBER_ROOM = 168;
const CHAR_EM = 0.5; // measured: Newsreader digits and the currency sign average about 0.47em
const NUMBER_MAX = 52;

/** Largest font size (px) at which a number of `chars` characters still fits inside the ring. */
export function numberSize(chars: number): number {
  return Math.min(NUMBER_MAX, Math.floor(NUMBER_ROOM / (CHAR_EM * Math.max(chars, 1))));
}

/** The pattern every screen opens with: ring, one number, one sentence. No card behind it. */
export function Hero({ tone, value, ringLabel, centre, caption, sentence }: HeroProps) {
  return (
    <section className="flex flex-col items-center gap-5 pt-2 pb-2 text-center">
      <Ring value={value} tone={tone} label={ringLabel}>
        <div
          className="num font-display leading-none font-medium tracking-tight whitespace-nowrap dark:font-normal"
          style={{ fontSize: typeof centre === "string" ? numberSize(centre.length) : NUMBER_MAX }}
        >
          {centre}
        </div>
        <div className="text-ink-muted mt-2 text-sm">{caption}</div>
      </Ring>
      <p className="font-display max-w-[34ch] text-[26px] leading-[1.2] text-balance @min-[900px]/app:text-[32px]">
        <SentenceText parts={sentence} />
      </p>
    </section>
  );
}
