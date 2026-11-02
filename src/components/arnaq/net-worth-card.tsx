import type { WorthPart } from "@/lib/view/net-worth-parts";
import { CountText } from "./count-text";

/**
 * Net worth now, as a short list: the big number, each account and the savings, and (when there is BTW data) one line for
 * the BTW. The BTW line is what the pocket holds minus what is still owed to the tax office: negative while the pocket is
 * short, positive when there is spare. It shows what a bar cannot, a part that takes money off.
 */
export function NetWorthCard({
  title,
  total,
  parts,
  btw,
  format,
}: {
  title: string;
  /** Net worth now, in cents. */
  total: number;
  parts: WorthPart[];
  /** Left out when there is no BTW data (or the pocket and what is owed cancel out exactly). */
  btw?: { label: string; amount: number };
  format: (cents: number) => string;
}) {
  return (
    <section aria-label={title} className="glass grid max-w-md gap-2 p-4 text-left">
      <div className="grid gap-0.5">
        <span className="text-ink-muted text-[13px]">{title}</span>
        <span className="num font-display text-[30px] leading-none font-medium tracking-[-0.02em]">
          <CountText text={format(total)} />
        </span>
      </div>
      <ul className="grid gap-1.5 text-[15px]">
        {parts.map((p) => (
          <li key={p.key} className="flex items-baseline justify-between gap-3">
            <span>{p.name}</span>
            <span className="num">{format(p.amount)}</span>
          </li>
        ))}
        {btw && btw.amount !== 0 && (
          <li
            className={`flex items-baseline justify-between gap-3 ${btw.amount < 0 ? "text-bad" : ""}`}
          >
            <span>{btw.label}</span>
            <span className="num">{format(btw.amount)}</span>
          </li>
        )}
      </ul>
    </section>
  );
}
