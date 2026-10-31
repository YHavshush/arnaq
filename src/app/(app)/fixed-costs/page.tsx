import { Suspense } from "react";
import { pageDb } from "@/lib/auth/request";
import { Hero } from "@/components/arnaq/hero";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader, Section } from "@/components/arnaq/page-header";
import { StatusChip } from "@/components/arnaq/status-chip";
import { FixedTrackerTable, TrackerLegend } from "@/components/arnaq/fixed-tracker";
import { Row } from "@/components/arnaq/row";
import { EmptyState, HeroSkeleton } from "@/components/arnaq/states";
import { AddItemForm, ItemManager, SuggestionList } from "@/components/arnaq/vaste-lasten-actions";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { formatter } from "@/lib/view/format";
import { loadVasteLasten, parseMonth } from "@/lib/view/load";
import type { VasteLastRow } from "@/lib/view/vaste-lasten";

export default function FixedCostsPage({ searchParams }: PageProps<"/fixed-costs">) {
  return (
    <Suspense fallback={<HeroSkeleton screen="fixedCosts" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/fixed-costs">, "searchParams">) {
  await requestTime();
  const { locale, t } = await getI18n();
  // Fixed costs are shown to the cent: 21.78 is not 22.
  const fmt = formatter(locale);
  const { euroExact: euro, dayLabel, monthName } = fmt;
  const today = todayIso();
  const month = parseMonth((await searchParams).month, today.slice(0, 7));
  const v = await pageDb((db) => loadVasteLasten(db, month, today, locale));
  const catName = new Map(v.categories.map((c) => [c.id, c.name]));
  // The stored (Dutch) name picks the icon; the label is what the person reads.
  const nameOf = (id: number | null) => (id === null ? null : (catName.get(id) ?? null));
  const f = t.ui.fixed;

  const sum = (rows: VasteLastRow[]) => rows.reduce((s, r) => s + r.amount, 0);
  const expenseTotal = sum(v.expenses);
  const incomeTotal = sum(v.income);
  const totalRow = (label: string, amount: number, strong = false) => (
    <li className="bg-soft/50 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 px-4 py-3">
      <span className={strong ? "font-semibold" : "text-ink-muted"}>{label}</span>
      <span className="num font-semibold">{euro(amount)}</span>
    </li>
  );

  const toRow = (r: VasteLastRow) => (
    <Row
      key={r.occurrenceId}
      icon={nameOf(r.categoryId)}
      name={r.name}
      meta={<StatusChip status={r.status} label={r.label} />}
      amount={euro(r.amount)}
      amountSub={r.status === "missed" ? f.missedLabel : undefined}
    />
  );

  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader
        title={f.title}
        sub={monthName(month)}
        step={{
          prev: `/fixed-costs?month=${v.prev}`,
          next: `/fixed-costs?month=${v.next}`,
          prevLabel: t.ui.step.to(monthName(v.prev)),
          nextLabel: t.ui.step.to(monthName(v.next)),
        }}
      />
      <Hero
        tone="accent"
        value={v.share}
        ringLabel={f.ring(v.paid, v.total)}
        centre={`${v.paid}/${v.total}`}
        caption={f.caption}
        sentence={v.sentence}
      />

      {v.total === 0 && v.income.length === 0 ? (
        <EmptyState title={f.emptyTitle}>{f.emptyBody}</EmptyState>
      ) : (
        <>
          {v.expenses.length > 0 && (
            <Section title={f.expenses} aside={f.toGo(euro(v.toCome))}>
              <div className="glass overflow-hidden">
                <ul className="divide-hair divide-y">
                  {v.expenses.map(toRow)}
                  {totalRow(f.totalExpenses, expenseTotal, true)}
                </ul>
              </div>
            </Section>
          )}
          {v.income.length > 0 && (
            <Section title={f.income}>
              <div className="glass overflow-hidden">
                <ul className="divide-hair divide-y">
                  {v.income.map(toRow)}
                  {totalRow(f.totalIncome, incomeTotal, true)}
                </ul>
              </div>
            </Section>
          )}
        </>
      )}

      {v.expenses.length > 0 && v.income.length > 0 && (
        <div className="glass mb-6 overflow-hidden">
          <ul className="divide-hair divide-y">
            {totalRow(f.leftAfterFixed, incomeTotal - expenseTotal, true)}
          </ul>
        </div>
      )}

      {(v.tracker.income.rows.length > 0 || v.tracker.expenses.rows.length > 0) && (
        <>
          {(
            [
              [f.tracker.incomeTitle, f.tracker.totalIncome, v.tracker.income],
              [f.tracker.expensesTitle, f.tracker.totalExpenses, v.tracker.expenses],
            ] as const
          ).map(
            ([title, totalLabel, table]) =>
              table.rows.length > 0 && (
                <Section
                  key={title}
                  title={title}
                  aside={f.tracker.range(
                    fmt.monthShort(v.tracker.months[0]),
                    fmt.monthShort(v.tracker.months[v.tracker.months.length - 1]),
                  )}
                >
                  <FixedTrackerTable
                    title={title}
                    totalLabel={totalLabel}
                    table={table}
                    months={v.tracker.months}
                    nowMonth={v.tracker.nowMonth}
                    focusMonth={month}
                    t={f.tracker}
                    f={fmt}
                  />
                </Section>
              ),
          )}
          <TrackerLegend t={f.tracker} />
        </>
      )}

      {v.missed.length > 0 && (
        <Section title={f.missed} aside={f.missedAside(v.missed.length)}>
          <div className="glass overflow-hidden">
            <ul className="divide-hair divide-y">
              {v.missed.slice(0, 6).map((o) => (
                <Row
                  key={o.id}
                  icon={nameOf(o.categoryId)}
                  name={o.itemName}
                  meta={f.expectedOn(dayLabel(o.expectedDate))}
                  amount={euro(o.expectedAmount)}
                />
              ))}
            </ul>
          </div>
          <p className="text-ink-muted mt-2 px-2 text-sm">{f.missedNote}</p>
        </Section>
      )}

      {(
        [
          [f.suggestionsCosts, v.suggestionsCosts],
          [f.suggestionsIncome, v.suggestionsIncome],
        ] as const
      ).map(
        ([title, list]) =>
          list.length > 0 && (
            <Section key={title} title={title} aside={f.suggestionsAside(list.length)}>
              <SuggestionList
                suggestions={list.map((s) => ({
                  key: s.key,
                  type: s.type,
                  name: s.name,
                  expectedAmount: s.expectedAmount,
                  dayOfMonth: s.dayOfMonth,
                  categoryName: nameOf(s.categoryId),
                  months: s.evidence.months.length,
                }))}
              />
            </Section>
          ),
      )}

      <Section title={f.manage}>
        <div className="grid gap-3">
          <ItemManager
            items={v.items.map((it) => ({
              id: it.id,
              name: it.name,
              type: it.type,
              expectedAmount: it.expectedAmount,
              dayOfMonth: it.dayOfMonth,
              frequency: it.frequency,
              active: it.active,
              categoryName: nameOf(it.categoryId),
            }))}
          />
          <div>
            <AddItemForm categories={v.categories} today={today} linkable={v.linkable} />
          </div>
        </div>
      </Section>
    </div>
  );
}
