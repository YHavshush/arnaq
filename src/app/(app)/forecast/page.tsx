import Link from "next/link";
import { Suspense } from "react";
import { pageDb } from "@/lib/auth/request";
import { Hero } from "@/components/kasboek/hero";
import { MonthList } from "@/components/kasboek/month-list";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader, Section } from "@/components/kasboek/page-header";
import { PrognoseChart } from "@/components/kasboek/prognose-chart";
import { EmptyState, HeroSkeleton } from "@/components/kasboek/states";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { formatter } from "@/lib/view/format";
import { HORIZONS, loadPrognose, parseHorizon } from "@/lib/view/load";

export default function ForecastPage({ searchParams }: PageProps<"/forecast">) {
  return (
    <Suspense fallback={<HeroSkeleton screen="forecast" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/forecast">, "searchParams">) {
  await requestTime();
  const { locale, t } = await getI18n();
  const f = formatter(locale);
  const today = todayIso();
  const months = parseHorizon((await searchParams).months);
  const p = await pageDb((db) => loadPrognose(db, today, months, locale));

  if (!p.hasForecast)
    return (
      <>
        <MoodSetter mood="neutral" />
        <PageHeader title={t.ui.forecast.title} sub={t.ui.forecast.subEmpty} />
        <EmptyState
          title={t.ui.forecast.emptyTitle}
          action={{ href: "/upload", label: t.ui.common.uploadStatement }}
        >
          {t.ui.forecast.emptyBody}
        </EmptyState>
      </>
    );

  return (
    <div className="fade-in">
      <MoodSetter mood={p.mood} />
      <PageHeader title={t.ui.forecast.title} sub={t.ui.forecast.subRange(months)} />
      <Hero
        tone={p.tone}
        value={p.share}
        ringLabel={t.ui.forecast.ring(p.inThePlus, p.ahead)}
        centre={f.euroSigned(p.growth)}
        caption={
          p.incomeMissing
            ? t.ui.forecast.captionSpend(p.points.at(-1)?.label ?? "")
            : t.ui.forecast.caption(p.points.at(-1)?.label ?? "")
        }
        sentence={p.sentence}
        detail={p.detail}
      />
      {p.incomeMissing && (
        <div className="flex justify-center pb-2">
          <Link
            href="/fixed-costs"
            className="bg-accent text-accent-ink inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold"
          >
            {t.ui.forecast.addIncome}
          </Link>
        </div>
      )}
      <Section
        title={t.ui.forecast.progress}
        aside={
          <nav aria-label={t.ui.forecast.horizon} className="bg-track inline-flex rounded-xl p-0.5">
            {HORIZONS.map((h) => (
              <Link
                key={h}
                href={`/forecast?months=${h}`}
                aria-current={h === months ? "true" : undefined}
                className="text-ink-muted aria-[current=true]:bg-surface aria-[current=true]:text-ink inline-flex min-h-9 min-w-9 items-center justify-center rounded-[10px] px-2.5 text-sm font-semibold"
              >
                {h}
              </Link>
            ))}
          </nav>
        }
      >
        <div className="glass p-3">
          <PrognoseChart points={p.points} currentMonth={today.slice(0, 7)} />
        </div>
        {p.lowConfidence && (
          <p className="text-ink-muted mt-3 px-2 text-sm">
            <strong className="text-ink font-semibold">{t.ui.forecast.note}</strong>{" "}
            {p.lowConfidence}
          </p>
        )}
      </Section>
      {!p.incomeMissing && (
        <Section title={t.ui.chart.allMonths}>
          <MonthList points={p.points} />
        </Section>
      )}
      <div className="text-ink-muted mt-4 grid gap-1 px-1 text-[13px]">
        {p.notes.map((note) => (
          <p key={note}>{note}</p>
        ))}
      </div>
    </div>
  );
}
