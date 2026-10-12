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
import { requestTime, todayIso } from "@/lib/api";
import { dayLabel, euro, monthName } from "@/lib/view/format";
import { loadVasteLasten, parseMonth } from "@/lib/view/load";
import type { VasteLastRow } from "@/lib/view/vaste-lasten";

export default function VasteLastenPage({ searchParams }: PageProps<"/vaste-lasten">) {
  return (
    <Suspense fallback={<HeroSkeleton label="Vaste lasten worden geladen" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/vaste-lasten">, "searchParams">) {
  await requestTime();
  const today = todayIso();
  const month = parseMonth((await searchParams).maand, today.slice(0, 7));
  const v = await loadVasteLasten(await getDb(), month, today);
  const catName = new Map(v.categories.map((c) => [c.id, c.name]));
  const nameOf = (id: number | null) => (id === null ? null : (catName.get(id) ?? null));

  const toRow = (r: VasteLastRow) => (
    <Row
      key={r.occurrenceId}
      icon={nameOf(r.categoryId)}
      name={r.name}
      meta={r.label}
      amount={euro(r.amount)}
      amountSub={r.status === "missed" ? "gemist" : undefined}
    />
  );

  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader
        title="Vaste lasten"
        sub={monthName(month)}
        step={{
          prev: `/vaste-lasten?maand=${v.prev}`,
          next: `/vaste-lasten?maand=${v.next}`,
          prevLabel: `Naar ${monthName(v.prev)}`,
          nextLabel: `Naar ${monthName(v.next)}`,
        }}
      />
      <Hero
        tone="accent"
        value={v.share}
        ringLabel={`${v.paid} van ${v.total} vaste lasten betaald`}
        centre={`${v.paid}/${v.total}`}
        caption="betaald"
        sentence={v.sentence}
      />

      {v.total === 0 && v.income.length === 0 ? (
        <EmptyState title="Nog geen vaste lasten">
          Voeg ze hieronder toe, of accepteer een suggestie zodra er genoeg maanden zijn geüpload.
        </EmptyState>
      ) : (
        <>
          {v.expenses.length > 0 && (
            <Section title="Uitgaven" aside={`${euro(v.toCome)} te gaan`}>
              <div className="glass overflow-hidden">
                <ul className="divide-hair divide-y">{v.expenses.map(toRow)}</ul>
              </div>
            </Section>
          )}
          {v.income.length > 0 && (
            <Section title="Inkomen">
              <div className="glass overflow-hidden">
                <ul className="divide-hair divide-y">{v.income.map(toRow)}</ul>
              </div>
            </Section>
          )}
        </>
      )}

      {v.missed.length > 0 && (
        <Section title="Gemist" aside={`${v.missed.length} om na te kijken`}>
          <div className="glass overflow-hidden">
            <ul className="divide-hair divide-y">
              {v.missed.slice(0, 6).map((o) => (
                <Row
                  key={o.id}
                  icon={nameOf(o.categoryId)}
                  name={o.itemName}
                  meta={`verwacht ${dayLabel(o.expectedDate)}`}
                  amount={euro(o.expectedAmount)}
                />
              ))}
            </ul>
          </div>
          <p className="text-ink-muted mt-2 px-2 text-sm">
            Geen betaling gevonden. Betaald met een ander bedrag of onder een andere naam? Pas de
            vaste last hieronder aan.
          </p>
        </Section>
      )}

      {v.suggestions.length > 0 && (
        <Section title="Gevonden in je afschriften" aside={`${v.suggestions.length} suggesties`}>
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

      <Section title="Beheren">
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
