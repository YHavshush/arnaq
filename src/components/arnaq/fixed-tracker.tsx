import Link from "next/link";
import { Check, X } from "lucide-react";
import type { Messages } from "@/i18n/messages";
import type { Formatter } from "@/lib/view/format";
import type { TrackerCell, TrackerTable } from "@/lib/view/fixed-tracker";
import { TrackerScroll } from "./tracker-scroll";

type T = Messages["ui"]["fixed"]["tracker"];

interface Props {
  title: string;
  totalLabel: string;
  table: TrackerTable;
  months: string[];
  /** Today's month: its column is highlighted. */
  nowMonth: string;
  /** The month on screen: the table starts scrolled to it. */
  focusMonth: string;
  t: T;
  f: Pick<Formatter, "euroExact" | "monthShort" | "monthName">;
}

/** One table of the fixed tracker: a row per fixed item, a column per month, a totals row. */
export function FixedTrackerTable({
  title,
  totalLabel,
  table,
  months,
  nowMonth,
  focusMonth,
  t,
  f,
}: Props) {
  const statusOf = (c: TrackerCell) => {
    const amount = f.euroExact(c.amount);
    if (c.kind === "paid") return t.status.paid(amount);
    if (c.kind === "late") return t.status.late(amount, c.lateDays ?? 0);
    if (c.kind === "missed") return t.status.missed(amount);
    if (c.kind === "expected") return t.status.expected(amount);
    return t.status.none;
  };

  const face = (c: TrackerCell) => {
    const amount = f.euroExact(c.amount);
    switch (c.kind) {
      case "paid":
        return (
          <span className="text-good inline-flex items-center gap-1">
            <Check aria-hidden className="size-3.5 shrink-0" strokeWidth={3} />
            {amount}
          </span>
        );
      case "late":
        return (
          <span className="text-warn inline-flex items-center gap-1">
            <Check aria-hidden className="size-3.5 shrink-0" strokeWidth={3} />
            {amount}
            <span className="text-xs">{t.lateShort(c.lateDays ?? 0)}</span>
          </span>
        );
      case "missed":
        return (
          <span className="text-bad inline-flex items-center gap-1 font-bold">
            <X aria-hidden className="size-3.5 shrink-0" strokeWidth={3} />
            {amount}
          </span>
        );
      case "expected":
        return <span className="text-ink-muted">{amount}</span>;
      default:
        return <span className="text-ink-muted">–</span>;
    }
  };

  const nowBg = (m: string) => (m === nowMonth ? "bg-soft" : "");

  return (
    <div className="bg-surface border-hair rounded-3xl border p-2">
      <TrackerScroll label={t.region(title)}>
        <table className="num w-full min-w-[620px] table-fixed border-separate border-spacing-0 text-[13px]">
          <caption className="sr-only">{title}</caption>
          <colgroup>
            <col className="w-[132px]" />
            {months.map((m) => (
              <col key={m} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th
                scope="col"
                className="bg-surface text-ink-muted sticky left-0 z-10 py-1.5 pr-2 pl-2 text-left font-semibold"
              >
                {t.item}
              </th>
              {months.map((m) => (
                <th
                  key={m}
                  scope="col"
                  title={f.monthName(m)}
                  aria-current={m === nowMonth ? "date" : undefined}
                  data-focus-col={m === focusMonth ? "" : undefined}
                  className={`px-2 py-1.5 text-right font-semibold whitespace-nowrap ${
                    m === nowMonth ? `${nowBg(m)} text-ink` : "text-ink-muted"
                  }`}
                >
                  {f.monthShort(m)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row) => (
              <tr key={row.itemId}>
                <th
                  scope="row"
                  title={row.name}
                  className="bg-surface border-hair sticky left-0 z-10 overflow-hidden border-t py-2.5 pr-2 pl-2 text-left font-semibold text-ellipsis whitespace-nowrap"
                >
                  {row.name}
                  {!row.active && (
                    <span className="text-ink-muted block text-xs font-normal">{t.paused}</span>
                  )}
                </th>
                {row.cells.map((c) => {
                  const status = statusOf(c);
                  const month = f.monthName(c.month);
                  const href =
                    (c.kind === "paid" || c.kind === "late") &&
                    row.categoryId !== null &&
                    c.transactionMonth
                      ? `/category/${row.categoryId}?month=${c.transactionMonth}`
                      : null;
                  return (
                    <td
                      key={c.month}
                      className={`border-hair border-t px-2 py-2.5 text-right whitespace-nowrap ${nowBg(c.month)}`}
                    >
                      {href ? (
                        <Link
                          href={href}
                          aria-label={t.open(row.name, month, status)}
                          className="-m-2 inline-block p-2 underline-offset-4 hover:underline"
                        >
                          {face(c)}
                        </Link>
                      ) : (
                        <>
                          {face(c)}
                          <span className="sr-only">{t.cell(row.name, month, status)}</span>
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th
                scope="row"
                className="bg-surface border-ink sticky left-0 z-10 border-t py-2.5 pr-2 pl-2 text-left font-bold"
              >
                {totalLabel}
              </th>
              {table.totals.map((sum, i) => (
                <td
                  key={months[i]}
                  className={`border-ink border-t px-2 py-2.5 text-right font-bold whitespace-nowrap ${nowBg(months[i])}`}
                >
                  {f.euroExact(sum)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </TrackerScroll>
    </div>
  );
}

/** The one-line key under the tables. */
export function TrackerLegend({ t }: { t: T }) {
  const l = t.legend;
  return (
    <p className="text-ink-muted mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-2 text-sm">
      <span className="inline-flex items-center gap-1">
        <Check aria-hidden className="text-good size-3.5" strokeWidth={3} />
        {l.paid}
      </span>
      <span className="inline-flex items-center gap-1">
        <Check aria-hidden className="text-warn size-3.5" strokeWidth={3} />
        <span className="text-warn">+3d</span> {l.late}
      </span>
      <span className="inline-flex items-center gap-1">
        <X aria-hidden className="text-bad size-3.5" strokeWidth={3} />
        {l.missed}
      </span>
      <span>{l.expected}</span>
      <span>
        <span aria-hidden>– </span>
        {l.none}
      </span>
    </p>
  );
}
