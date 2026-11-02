import type { WorthLegendEntry } from "@/lib/view/worth-ring";
import { slotColour } from "./split-ring";

/**
 * What the ring is made of: one line per part of net worth with its amount, the dot in the colour of its arc. A part
 * without money (an account in the red, the BTW still owed) has a dot and a red amount but no arc.
 */
export function WorthLegend({
  entries,
  format,
}: {
  entries: WorthLegendEntry[];
  format: (cents: number) => string;
}) {
  return (
    <ul className="grid w-full max-w-[19rem] gap-1.5 text-left text-[14px]">
      {entries.map((e) => (
        <li
          key={e.key}
          className="grid grid-cols-[0.75rem_minmax(0,1fr)_auto] items-center gap-2.5"
        >
          <i
            aria-hidden
            className="block size-3 rounded-full"
            style={{ background: slotColour(e.slot) }}
          />
          <span className="truncate">{e.name}</span>
          <span className={`num ${e.amount < 0 ? "text-bad" : "text-ink-muted"}`}>
            {format(e.amount)}
          </span>
        </li>
      ))}
    </ul>
  );
}
