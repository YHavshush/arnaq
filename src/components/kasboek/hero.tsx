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

/** The pattern every screen opens with: ring, one number, one sentence. No card behind it. */
export function Hero({ tone, value, ringLabel, centre, caption, sentence }: HeroProps) {
  return (
    <section className="flex flex-col items-center gap-5 pt-2 pb-2 text-center">
      <Ring value={value} tone={tone} label={ringLabel}>
        <div className="num font-display text-[52px] leading-none font-medium tracking-tight dark:font-normal">
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
