import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db";
import { Hero } from "@/components/kasboek/hero";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader, Section } from "@/components/kasboek/page-header";
import { Row } from "@/components/kasboek/row";
import { EmptyState, HeroSkeleton } from "@/components/kasboek/states";
import { StatusTile } from "@/components/kasboek/status-tile";
import { getI18n } from "@/i18n/server";
import type { Messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";
import { requestTime, todayIso } from "@/lib/api";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { loadOverzicht, parseMonth } from "@/lib/view/load";
import type { OverzichtRow } from "@/lib/view/overzicht";

export default function Overview({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<HeroSkeleton screen="overview" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

function rowProps(r: OverzichtRow, t: Messages, locale: Locale) {
  const { euro, dayLabel } = formatter(locale);
  const o = t.ui.overview;
  const onlyPlanned = r.actual === 0 && r.planned > 0;
  const uncategorised = r.categoryId === null;
  return {
    icon: uncategorised ? null : r.name,
    name: uncategorised ? r.name : categoryLabel(r.name, locale),
    meta:
      r.planned > 0 && !onlyPlanned
        ? o.metaPlanned(euro(r.planned))
        : r.budget !== null && !onlyPlanned
          ? r.actual > r.budget
            ? o.metaOverBudget(euro(r.actual - r.budget))
            : r.actual === r.budget
              ? o.metaExactly
              : o.metaLeft(euro(r.budget - r.actual))
          : undefined,
    amount: euro(onlyPlanned ? r.planned : r.actual),
    amountSub: onlyPlanned
      ? o.subDue(dayLabel(r.nextDate!))
      : r.budget !== null
        ? o.subOf(euro(r.budget))
        : undefined,
    bar:
      r.budget !== null && r.budget > 0
        ? { filled: r.actual / r.budget, planned: r.planned / r.budget, state: r.state }
        : undefined,
  };
}

async function Content({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await requestTime();
  const { locale, t } = await getI18n();
  const f = formatter(locale);
  const today = todayIso();
  const month = parseMonth((await searchParams).month, today.slice(0, 7));
  const o = await loadOverzicht(await getDb(), month, today, locale);
  const step = {
    prev: `/?month=${o.prev}`,
    next: `/?month=${o.next}`,
    prevLabel: t.ui.step.to(f.monthName(o.prev)),
    nextLabel: t.ui.step.to(f.monthName(o.next)),
  };

  if (!o.hasActivity)
    return (
      <>
        <MoodSetter mood="neutral" />
        <PageHeader title={t.ui.overview.title} sub={f.monthName(month)} step={step} />
        <EmptyState
          title={t.ui.overview.emptyTitle(f.monthName(month))}
          action={{ href: "/upload", label: t.ui.common.uploadStatement }}
        >
          {t.ui.overview.emptyBody}
        </EmptyState>
      </>
    );

  const shown = o.rows.slice(0, 8);
  const rest = o.rows.slice(8);
  return (
    <div className="fade-in">
      <MoodSetter mood={o.mood} />
      <PageHeader title={t.ui.overview.title} sub={f.monthName(month)} step={step} />
      <div className="@min-[900px]/app:grid @min-[900px]/app:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @min-[900px]/app:items-center @min-[900px]/app:gap-8">
        <Hero
          tone={o.tone}
          value={o.used ?? (o.spent > 0 ? 1 : 0)}
          ringLabel={
            o.used === null
              ? t.ui.overview.ringNoBudget
              : t.ui.overview.ringUsed(Math.round(o.used * 100))
          }
          centre={o.free === null ? f.euro(o.spent) : f.euro(o.free)}
          caption={
            o.free === null
              ? t.ui.overview.captionSpent
              : o.free < 0
                ? t.ui.overview.captionOver
                : t.ui.overview.captionFree
          }
          sentence={o.sentence}
        />
        <div className="mt-6 grid grid-cols-2 gap-3 @min-[900px]/app:mt-0">
          {o.tiles.map((tile) => (
            <StatusTile key={tile.key} tile={tile} />
          ))}
        </div>
      </div>

      <Section
        title={t.ui.overview.expenses}
        aside={
          <Link href={`/budget?month=${month}`} className="text-accent font-semibold">
            {t.ui.overview.setBudget}
          </Link>
        }
      >
        {o.rows.length === 0 ? (
          <p className="glass text-ink-muted px-4 py-6 text-center text-[15px]">
            {t.ui.overview.noExpenses}
          </p>
        ) : (
          <div className="glass overflow-hidden">
            <ul className="divide-hair divide-y">
              {shown.map((r) => (
                <Row key={r.categoryId ?? "none"} {...rowProps(r, t, locale)} />
              ))}
            </ul>
            {rest.length > 0 && (
              <details className="border-hair group border-t">
                <summary className="text-accent min-h-11 cursor-pointer list-none px-4 py-3 text-center text-[15px] font-semibold group-open:hidden">
                  {t.ui.overview.showMore(rest.length)}
                </summary>
                <ul className="divide-hair divide-y">
                  {rest.map((r) => (
                    <Row key={r.categoryId ?? "none"} {...rowProps(r, t, locale)} />
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
