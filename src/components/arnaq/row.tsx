import Link from "next/link";
import type { ReactNode } from "react";
import { CategoryIcon } from "./category-icon";

const BAR: Record<string, string> = {
  none: "var(--ring-accent-to)",
  ok: "var(--ring-accent-to)",
  warn: "var(--ring-warn-to)",
  bad: "var(--ring-bad-to)",
  done: "var(--ring-good-to)",
  planned: "var(--ink-muted)",
};

interface RowProps {
  /** Category name for the icon chip (null: neutral). */
  icon: string | null;
  name: string;
  /** A small word next to the name, e.g. "fixed". */
  tag?: string;
  meta?: ReactNode;
  amount: ReactNode;
  amountSub?: ReactNode;
  /** Optional status bar: filled share and the share that is planned but not yet spent. */
  bar?: { filled: number; planned?: number; state: keyof typeof BAR };
  /** Makes the whole row a link (a stretched link, so the amount and the bar stay selectable text). */
  href?: string;
}

/** Icon chip + name + amount, with an optional thin status bar. */
export function Row({ icon, name, tag, meta, amount, amountSub, bar, href }: RowProps) {
  const pct = (n: number) => `${Math.max(0, Math.min(n, 1)) * 100}%`;
  return (
    <li className="relative grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
      {href && (
        <Link href={href} aria-label={name} className="absolute inset-0 z-10 active:bg-black/5" />
      )}
      <CategoryIcon name={icon} />
      <div className="min-w-0">
        <div className="truncate text-base leading-tight font-semibold">
          {name}
          {tag && <span className="text-ink-muted ml-1.5 text-[13px] font-normal">{tag}</span>}
        </div>
        {meta && <div className="text-ink-muted mt-0.5 text-[13px]">{meta}</div>}
        {bar && (
          <div aria-hidden className="bg-track mt-2 flex h-1 overflow-hidden rounded-full">
            <i
              className="block h-full rounded-full"
              style={{ width: pct(bar.filled), background: BAR[bar.state] }}
            />
            {bar.planned ? (
              <i
                className="block h-full opacity-45"
                style={{ width: pct(bar.planned), background: BAR[bar.state] }}
              />
            ) : null}
          </div>
        )}
      </div>
      <div className="num text-right text-base font-semibold tracking-tight">
        {amount}
        {amountSub && <div className="text-ink-muted text-[13px] font-medium">{amountSub}</div>}
      </div>
    </li>
  );
}
