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
  format,
}: {
  parts: WorthPart[];
  /** The line above the bar. */
  label: string;
  format: (cents: number) => string;
}) {
  const visible = parts.filter((p) => p.share > 0);
  return (
    <div className="grid gap-2 text-left">
      <div className="text-ink-muted text-[13px]">{label}</div>
      <div
        role="img"
        aria-label={parts.map((p) => `${p.name} ${format(p.amount)}`).join(", ")}
        className="flex h-3 gap-[3px] overflow-hidden rounded-full"
      >
        {visible.map((p) => (
          <i
            key={p.key}
            className="block h-full first:rounded-l-full last:rounded-r-full"
            style={{
              width: `${p.share * 100}%`,
              background: COLOURS[parts.indexOf(p) % COLOURS.length],
            }}
          />
        ))}
      </div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
        {parts.map((p, i) => (
          <li key={p.key} className="inline-flex items-center gap-1.5">
            <i
              aria-hidden
              className="block size-2.5 rounded-full"
              style={{ background: COLOURS[i % COLOURS.length] }}
            />
            {p.name} <b className="num font-semibold">{format(p.amount)}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
