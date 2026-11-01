import type { Messages } from "@/i18n/messages";
import type { SplitRingModel } from "@/lib/view/fixed-ring";
import type { Formatter } from "@/lib/view/format";
import type { Sentence } from "@/lib/view/overzicht";
import { numberSize } from "./hero";
import { SentenceText } from "./sentence";
import { SplitRing, TO_PAY_OPACITY, slotColour } from "./split-ring";

type T = Messages["ui"]["fixed"]["hero"];

/**
 * The top of the Fixed page: the month's income as a ring split by fixed expense, what is left over
 * in the middle, a one-line legend and one sentence. Amounts are shown to the cent so the three
 * numbers always add up.
 */
export function FixedHero({
  ring,
  t,
  fmt,
}: {
  ring: SplitRingModel;
  t: T;
  fmt: Pick<Formatter, "euroExact">;
}) {
  const { euroExact: euro } = fmt;
  const { mode } = ring;

  const centre =
    mode === "noIncome"
      ? { text: euro(ring.fixed), caption: t.fixedCaption, bad: false }
      : mode === "short"
        ? { text: euro(-ring.leftOver), caption: t.short, bad: true }
        : { text: euro(ring.leftOver), caption: t.leftOver, bad: false };

  const label =
    mode === "noIncome"
      ? t.ringLabelNoIncome(euro(ring.fixed))
      : mode === "short"
        ? t.ringLabelShort(euro(ring.income), euro(ring.fixed), euro(-ring.leftOver))
        : t.ringLabel(euro(ring.income), euro(ring.fixed), euro(ring.leftOver));

  const sentence: Sentence =
    mode === "noIncome"
      ? t.sentence.noIncome(euro(ring.fixed))
      : mode === "short"
        ? t.sentence.short(euro(ring.income), euro(ring.fixed), euro(-ring.leftOver))
        : ring.fixed === 0
          ? t.sentence.noFixed(euro(ring.income))
          : t.sentence.normal(euro(ring.income), euro(ring.fixed));

  return (
    <section className="flex flex-col items-center gap-4 pt-2 pb-2 text-center">
      <SplitRing segments={ring.segments} label={label}>
        <div
          className={`num leading-none font-medium tracking-[-0.035em] whitespace-nowrap dark:font-normal ${centre.bad ? "text-bad" : ""}`}
          style={{ fontSize: numberSize(centre.text.length) }}
        >
          {centre.text}
        </div>
        <div className={`mt-2 text-sm ${centre.bad ? "text-bad" : "text-ink-muted"}`}>
          {centre.caption}
        </div>
      </SplitRing>
      {ring.legend.length > 0 && (
        <ul className="text-ink-muted flex max-w-[34ch] flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] @min-[900px]/app:max-w-none">
          {ring.legend.map((l) => (
            <li key={l.key} className="inline-flex items-center gap-1.5">
              <i
                aria-hidden
                className="inline-block size-2.5 shrink-0 rounded-full"
                style={{ background: slotColour(l.slot), opacity: l.paid ? 1 : TO_PAY_OPACITY }}
              />
              <span>
                {l.name ?? t.other} <span className="num">{euro(l.amount)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="font-display max-w-[30ch] text-[26px] leading-[1.2] text-balance">
        <SentenceText parts={sentence} />
      </p>
    </section>
  );
}
