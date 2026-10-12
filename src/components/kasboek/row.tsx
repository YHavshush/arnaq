import type { ReactNode } from "react";
import { CategoryIcon } from "./category-icon";

const BAR: Record<string, string> = {
  none: "var(--ring-accent-to)",
  ok: "var(--ring-accent-to)",
  warn: "var(--ring-warn-to)",
  bad: "var(--ring-bad-to)",
  done: "var(--ring-good-to)",
};

interface RowProps {
  /** Category name for the icon chip (null: neutral). */
  icon: string | null;
  name: string;
  meta?: ReactNode;
  amount: ReactNode;
  amountSub?: ReactNode;
  /** Optional status bar: filled share and the share that is planned but not yet spent. */
  bar?: { filled: number; planned?: number; state: keyof typeof BAR };
}

/** Icon chip + name + amount, with an optional thin status bar. */
export function Row({ icon, name, meta, amount, amountSub, bar }: RowProps) {
  const pct = (n: number) => `${Math.max(0, Math.min(n, 1)) * 100}%`;
  return (
    <li className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3">
      <CategoryIcon name={icon} />
      <div className="min-w-0">
        <div className="truncate text-base leading-tight font-semibold">{name}</div>
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
