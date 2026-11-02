import type { Messages } from "@/i18n/messages";
import type { SplitRingModel } from "@/lib/view/fixed-ring";
import type { Formatter } from "@/lib/view/format";
import type { Sentence } from "@/lib/view/overzicht";
import { displayName } from "@/lib/view/names";
import { numberSize } from "./hero";
import { SentenceText } from "./sentence";
import { SplitRing, TO_PAY_OPACITY, slotColour } from "./split-ring";

type T = Messages["ui"]["fixed"]["hero"];

/**
 * The top of the Fixed page: the month's income as a ring split by fixed expense, what is left over
 * in the middle, one sentence and a legend (beside the ring on a laptop, under it on a phone). Whole euros here: the exact cents are in the list below.
 */
export function FixedHero({
  ring,
  t,
  fmt,
}: {
  ring: SplitRingModel;
  t: T;
  fmt: Pick<Formatter, "euro">;
}) {
  const { euro } = fmt;
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
    <section className="grid gap-4 pt-2 pb-2 text-center @min-[900px]/app:grid-cols-[auto_minmax(0,1fr)] @min-[900px]/app:items-center @min-[900px]/app:gap-12 @min-[900px]/app:text-left">
      <div className="flex justify-center @min-[900px]/app:justify-start">
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
      </div>
      <div className="grid justify-items-center gap-4 @min-[900px]/app:justify-items-start">
        <p className="font-display max-w-[30ch] text-[22px] leading-[1.2] text-balance @min-[900px]/app:text-[30px]">
          <SentenceText parts={sentence} />
        </p>
        {ring.legend.length > 0 && (
          <ul className="grid w-full max-w-[19rem] gap-1.5 text-left text-[14px]">
            {ring.legend.map((l) => (
              <li
                key={l.key}
                className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-2.5"
              >
                <i
                  aria-hidden
                  className="block size-3 rounded-full"
                  style={{ background: slotColour(l.slot), opacity: l.paid ? 1 : TO_PAY_OPACITY }}
                />
                <span className="truncate">{l.name ? displayName(l.name) : t.other}</span>
                <span className="num text-ink-muted">{euro(l.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
