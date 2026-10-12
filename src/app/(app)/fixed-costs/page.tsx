import { Suspense } from "react";
import { getDb } from "@/db";
import { Hero } from "@/components/kasboek/hero";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader, Section } from "@/components/kasboek/page-header";
import { Row } from "@/components/kasboek/row";
import { EmptyState, HeroSkeleton } from "@/components/kasboek/states";
import {
  AddItemForm,
  ItemManager,
  SuggestionList,
} from "@/components/kasboek/vaste-lasten-actions";
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
  const { euro, dayLabel, monthName } = formatter(locale);
  const today = todayIso();
  const month = parseMonth((await searchParams).month, today.slice(0, 7));
  const v = await loadVasteLasten(await getDb(), month, today, locale);
  const catName = new Map(v.categories.map((c) => [c.id, c.name]));
  // The stored (Dutch) name picks the icon; the label is what the person reads.
  const nameOf = (id: number | null) => (id === null ? null : (catName.get(id) ?? null));
  const f = t.ui.fixed;

  const toRow = (r: VasteLastRow) => (
    <Row
      key={r.occurrenceId}
      icon={nameOf(r.categoryId)}
      name={r.name}
      meta={r.label}
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
                <ul className="divide-hair divide-y">{v.expenses.map(toRow)}</ul>
              </div>
            </Section>
          )}
          {v.income.length > 0 && (
            <Section title={f.income}>
              <div className="glass overflow-hidden">
                <ul className="divide-hair divide-y">{v.income.map(toRow)}</ul>
              </div>
            </Section>
          )}
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

      {v.suggestions.length > 0 && (
        <Section title={f.suggestions} aside={f.suggestionsAside(v.suggestions.length)}>
          <SuggestionList
            suggestions={v.suggestions.map((s) => ({
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
            <AddItemForm categories={v.categories} today={today} />
          </div>
        </div>
      </Section>
    </div>
  );
}
