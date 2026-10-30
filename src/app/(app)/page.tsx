import Link from "next/link";
import { Suspense } from "react";
import { pageDb } from "@/lib/auth/request";
import { AttentionList } from "@/components/arnaq/attention-list";
import { Hero } from "@/components/arnaq/hero";
import { IncomeList } from "@/components/arnaq/income-list";
import { MoodSetter } from "@/components/arnaq/mood";
import { PaceCard } from "@/components/arnaq/pace-card";
import { LoadSampleButton } from "@/components/arnaq/sample";
import { PageHeader, Section } from "@/components/arnaq/page-header";
import { Row } from "@/components/arnaq/row";
import { EmptyState, HeroSkeleton } from "@/components/arnaq/states";
import { UpcomingList } from "@/components/arnaq/upcoming-list";
import { getI18n } from "@/i18n/server";
import type { Messages } from "@/i18n/messages";
import type { Locale } from "@/i18n/config";
import { requestTime, todayIso } from "@/lib/api";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { canLoadSample } from "@/lib/sample/sample";
import { loadOverzicht, parseMonth } from "@/lib/view/load";
import type { OverzichtRow } from "@/lib/view/overzicht";

export default function Overview({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<HeroSkeleton screen="overview" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

function SavingsRow({
  row,
  t,
  locale,
}: {
  row: NonNullable<Awaited<ReturnType<typeof loadOverzicht>>["savingsRow"]>;
  t: Messages;
  locale: Locale;
}) {
  const { euro, euroExact } = formatter(locale);
  const s = t.ui.overview.savingsRow;
  const sub =
    row.goal !== null
      ? s.ofGoal(euro(row.goal))
      : row.thisMonth > 0
        ? s.moved(euro(row.thisMonth))
        : row.thisMonth < 0
          ? s.taken(euro(-row.thisMonth))
          : undefined;
  return (
    <Row
      icon="Spaarrekening"
      name={s.name}
      amount={euroExact(row.saved)}
      amountSub={sub}
      bar={
        row.goal !== null && row.goal > 0
          ? {
              filled: row.saved / row.goal,
              planned: 0,
              state: row.saved >= row.goal ? "done" : "none",
            }
          : undefined
      }
    />
  );
}

function rowProps(r: OverzichtRow, t: Messages, locale: Locale, month: string) {
  const { euro, dayLabel } = formatter(locale);
  const o = t.ui.overview;
  const onlyPlanned = r.actual === 0 && r.planned > 0;
  const uncategorised = r.categoryId === null;
  const total = r.actual + r.planned;
  const over = r.budget !== null && total > r.budget;
  return {
    href: uncategorised ? "/upload#sort" : `/category/${r.categoryId}?month=${month}`,
    icon: uncategorised ? null : r.name,
    name: uncategorised ? r.name : categoryLabel(r.name, locale),
    tag: r.fixed ? o.tagFixed : undefined,
    amount: euro(onlyPlanned ? r.planned : r.actual),
    amountSub: onlyPlanned ? (
      o.subDue(dayLabel(r.nextDate!))
    ) : over ? (
      <span className="text-bad">{o.subOver(euro(total - r.budget!))}</span>
    ) : r.budget !== null ? (
      o.subOf(euro(r.budget))
    ) : undefined,
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
  const o = await pageDb((db) => loadOverzicht(db, month, today, locale));
  const offerSample = !o.hasActivity && (await pageDb((db) => canLoadSample(db)));
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
          extra={offerSample ? <LoadSampleButton /> : undefined}
        >
          {t.ui.overview.emptyBody}
        </EmptyState>
      </>
    );

  const shown = o.rows.slice(0, 5);
  const rest = o.rows.slice(5);
  return (
    <div className="fade-in">
      <MoodSetter mood={o.mood} />
      <PageHeader title={t.ui.overview.title} sub={f.monthName(month)} step={step} />
      <Hero
        tone={o.tone}
        value={o.used ?? (o.spent > 0 ? 1 : 0)}
        ringLabel={
          o.used === null
            ? t.ui.overview.ringNoBudget
            : o.basis === "income"
              ? t.ui.overview.ringIncomeUsed(Math.round(o.used * 100))
              : t.ui.overview.ringUsed(Math.round(o.used * 100))
        }
        centre={o.free === null ? f.euro(o.spent) : f.euro(Math.abs(o.free))}
        caption={
          o.free === null
            ? t.ui.overview.captionSpent
            : o.free < 0
              ? t.ui.overview.captionOver
              : t.ui.overview.captionFree
        }
        sentence={o.sentence}
        detail={o.detail}
        facts={o.facts}
      />
      <AttentionList items={o.attention} />

      <div className="@min-[900px]/app:grid @min-[900px]/app:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] @min-[900px]/app:items-start @min-[900px]/app:gap-8">
        <div className="min-w-0">
          {o.pace && (
            <Section title={t.ui.overview.paceTitle} aside={t.ui.overview.paceAside}>
              <PaceCard pace={o.pace} month={month} />
            </Section>
          )}
          <Section
            title={t.ui.overview.whereTitle}
            aside={
              <span className="flex items-baseline gap-3">
                {o.budget !== null && (
                  <span className="num hidden @min-[560px]/app:inline">
                    {t.ui.overview.whereTotal(f.euro(o.spent + o.planned), f.euro(o.budget))}
                  </span>
                )}
                <Link href={`/budget?month=${month}`} className="text-accent font-semibold">
                  {t.ui.overview.setBudget}
                </Link>
              </span>
            }
          >
            {o.rows.length === 0 ? (
              <p className="glass text-ink-muted px-4 py-6 text-center text-[15px]">
                {t.ui.overview.noExpenses}
              </p>
            ) : (
              <div className="glass overflow-hidden">
                <ul className="divide-hair divide-y">
                  {o.savingsRow && <SavingsRow row={o.savingsRow} t={t} locale={locale} />}
                  {shown.map((r) => (
                    <Row key={r.categoryId ?? "none"} {...rowProps(r, t, locale, month)} />
                  ))}
                </ul>
                {rest.length > 0 && (
                  <details className="border-hair group border-t">
                    <summary className="text-accent min-h-11 cursor-pointer list-none px-4 py-3 text-center text-[15px] font-semibold group-open:hidden">
                      {t.ui.overview.allCategories(o.rows.length)}
                    </summary>
                    <ul className="divide-hair divide-y">
                      {rest.map((r) => (
                        <Row key={r.categoryId ?? "none"} {...rowProps(r, t, locale, month)} />
                      ))}
                    </ul>
                  </details>
                )}
              </div>
            )}
          </Section>
        </div>

        <div className="min-w-0">
          {o.income.length > 0 && (
            <Section
              title={t.ui.overview.incomeTitle}
              aside={t.ui.overview.incomeAside(f.euro(o.incomeReceived))}
            >
              <IncomeList rows={o.income} />
            </Section>
          )}
          {o.upcoming.length > 0 && (
            <Section
              title={t.ui.overview.upcomingTitle}
              aside={
                <Link href="/fixed-costs" className="text-accent font-semibold">
                  {t.ui.overview.upcomingAll}
                </Link>
              }
            >
              <UpcomingList rows={o.upcoming} />
            </Section>
          )}
        </div>
      </div>

      <p className="text-ink-muted mt-8 px-1 text-[13px]">
        {t.ui.overview.footnote(o.transactionCount)}
      </p>
    </div>
  );
}
