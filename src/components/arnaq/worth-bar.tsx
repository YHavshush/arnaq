import type { WorthPart } from "@/lib/view/net-worth-parts";

/** One colour per part, from the ring tokens: no new colours. */
const COLOURS = [
  "var(--ring-accent-from)",
  "var(--ring-accent-to)",
  "var(--ring-good-to)",
  "var(--ring-warn-to)",
];

/** Where the money is: one bar split into accounts and savings, with the amounts under it. */
export function WorthBar({
  parts,
  label,
  total,
  totalLabel,
  format,
}: {
  parts: WorthPart[];
  /** The line above the bar. */
  label: string;
  /** Net worth now, formatted, with its label ("now"). */
  total: string;
  totalLabel: string;
  format: (cents: number) => string;
}) {
  const visible = parts.filter((p) => p.share > 0);
  // A segment wide enough carries its own name and amount; the others are named under the bar.
  const inside = (p: WorthPart) => p.share >= 0.2;
  const outside = parts.filter((p) => !inside(p));
  return (
    <div className="grid gap-2 text-left">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-ink-muted text-[13px]">{label}</span>
        <span className="num text-[15px]">
          <b className="font-semibold">{total}</b>{" "}
          <span className="text-ink-muted">{totalLabel}</span>
        </span>
      </div>
      <div
        role="img"
        aria-label={parts.map((p) => `${p.name} ${format(p.amount)}`).join(", ")}
        className="flex h-14 gap-[3px] overflow-hidden rounded-2xl"
      >
        {visible.map((p) => (
          <i
            key={p.key}
            className="grid min-w-0 content-center justify-items-start px-3 leading-tight text-[#0b1626] not-italic"
            style={{
              width: `${p.share * 100}%`,
              background: COLOURS[parts.indexOf(p) % COLOURS.length],
            }}
          >
            {inside(p) && (
              <>
                <span className="w-full truncate text-xs opacity-90">{p.name}</span>
                <b className="num w-full truncate text-[15px] font-semibold">{format(p.amount)}</b>
              </>
            )}
          </i>
        ))}
      </div>
      {outside.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {outside.map((p) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <i
                aria-hidden
                className="block size-2.5 rounded-full"
                style={{ background: COLOURS[parts.indexOf(p) % COLOURS.length] }}
              />
              {p.name} <b className="num font-semibold">{format(p.amount)}</b>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
