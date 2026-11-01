import { Suspense } from "react";
import { pageDb } from "@/lib/auth/request";
import { FixedHero } from "@/components/arnaq/fixed-hero";
import { FixedList, type ListSection } from "@/components/arnaq/fixed-list";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader } from "@/components/arnaq/page-header";
import { EmptyState, HeroSkeleton } from "@/components/arnaq/states";
import {
  AddItemForm,
  SuggestionsCard,
  type SuggestionView,
} from "@/components/arnaq/vaste-lasten-actions";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { formatter } from "@/lib/view/format";
import { loadVasteLasten, parseMonth } from "@/lib/view/load";

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
  const { monthName } = fmt;
  const today = todayIso();
  const month = parseMonth((await searchParams).month, today.slice(0, 7));
  const v = await pageDb((db) => loadVasteLasten(db, month, today, locale));
  const catName = new Map(v.categories.map((c) => [c.id, c.name]));
  // The stored (Dutch) name picks the icon; the label is what the person reads.
  const nameOf = (id: number | null) => (id === null ? null : (catName.get(id) ?? null));
  const f = t.ui.fixed;

  const sections: ListSection[] = [v.list.expenses, v.list.income].map((s) => ({
    ...s,
    rows: s.rows.map((r) => ({ ...r, categoryName: nameOf(r.categoryId) })),
  }));
  const suggest = (list: typeof v.suggestionsCosts): SuggestionView[] =>
    list.map((s) => ({
      key: s.key,
      type: s.type,
      name: s.name,
      expectedAmount: s.expectedAmount,
      dayOfMonth: s.dayOfMonth,
      categoryName: nameOf(s.categoryId),
      months: s.evidence.months.length,
    }));
  const suggestions = (
    <SuggestionsCard costs={suggest(v.suggestionsCosts)} income={suggest(v.suggestionsIncome)} />
  );
  const add = (
    <div className="mt-8">
      <AddItemForm categories={v.categories} today={today} linkable={v.linkable} />
    </div>
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

      {v.items.length === 0 ? (
        <>
          <EmptyState title={f.emptyTitle}>{f.emptyBody}</EmptyState>
          <div className="mt-6">{suggestions}</div>
          {add}
        </>
      ) : (
        // Laptop (app width 900px or more): the ring on the left, the list on the right.
        <div className="@min-[900px]/app:grid @min-[900px]/app:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] @min-[900px]/app:items-start @min-[900px]/app:gap-12">
          {v.ring.mode !== "empty" && (
            <div className="@min-[900px]/app:sticky @min-[900px]/app:top-6">
              <FixedHero ring={v.ring} t={f.hero} fmt={fmt} />
            </div>
          )}
          <div className="mt-6 min-w-0 @min-[900px]/app:col-start-2 @min-[900px]/app:mt-0">
            {suggestions}
            <FixedList sections={sections} month={month} />
            {add}
          </div>
        </div>
      )}
    </div>
  );
}
