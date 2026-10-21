import Link from "next/link";
import type { Tone } from "@/design/tokens";
import type { AttentionItem } from "@/lib/view/overzicht";

const DOT: Record<Tone, string> = {
  accent: "var(--ring-accent-to)",
  good: "var(--ring-good-to)",
  warn: "var(--ring-warn-to)",
  bad: "var(--ring-bad-to)",
};

/** What needs a look right now, each with the one thing to do about it. */
export function AttentionList({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="glass divide-hair mt-6 divide-y overflow-hidden">
      {items.map((item) => (
        <li
          key={item.key}
          className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
        >
          <span
            aria-hidden
            className="size-2 rounded-full"
            style={{ background: DOT[item.tone] }}
          />
          <div className="min-w-0">
            <div className="text-[15px] leading-tight font-semibold">{item.title}</div>
            <div className="text-ink-muted mt-0.5 text-[13px]">{item.sub}</div>
          </div>
          <Link
            href={item.action.href}
            className={
              item.action.primary
                ? "bg-accent text-accent-ink inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold"
                : "bg-soft text-accent inline-flex min-h-11 items-center rounded-full px-4 text-sm font-semibold"
            }
          >
            {item.action.label}
          </Link>
        </li>
      ))}
    </ul>
  );
}
