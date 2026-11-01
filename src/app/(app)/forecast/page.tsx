import Link from "next/link";
import { Suspense } from "react";
import { pageDb } from "@/lib/auth/request";
import { BtwCard } from "@/components/arnaq/btw-card";
import { StepLink } from "@/components/arnaq/step-link";
import { AheadHeader } from "@/components/arnaq/ahead-header";
import { MonthList } from "@/components/arnaq/month-list";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader, Section } from "@/components/arnaq/page-header";
import { PrognoseChart } from "@/components/arnaq/prognose-chart";
import { EmptyState, HeroSkeleton } from "@/components/arnaq/states";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { getBtwSummary } from "@/lib/btw/summary";
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
  const btw = await pageDb((db) => getBtwSummary(db, { today }));

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
      <AheadHeader
        label={
          p.incomeMissing
            ? t.ui.forecast.captionSpend(p.points.at(-1)?.label ?? "")
            : p.netWorth
              ? t.ui.forecast.captionWorth(p.points.at(-1)?.label ?? "")
              : t.ui.forecast.caption(p.points.at(-1)?.label ?? "")
        }
        amount={p.netWorth && !p.incomeMissing ? f.euro(p.netWorth.end) : f.euroSigned(p.growth)}
        pill={
          p.netWorth && !p.incomeMissing
            ? {
                text: t.ui.forecast.growthPill(f.euroSigned(p.growth), months),
                good: p.growth >= 0,
              }
            : undefined
        }
        sentence={p.sentence}
        detail={p.detail}
      />
      {p.netWorth && (
        <div className="pb-3">
          <Link href="/net-worth" className="text-accent min-h-11 text-[15px] font-semibold">
            {t.ui.forecast.howBuilt}
          </Link>
        </div>
      )}
      {p.incomeMissing && (
        <div className="pb-2">
          <Link
            href="/fixed-costs"
            className="bg-action text-action-ink inline-flex min-h-11 items-center rounded-full px-5 text-sm font-semibold"
          >
            {t.ui.forecast.addIncome}
          </Link>
        </div>
      )}
      <Section
        title={p.hasBalance ? t.ui.forecast.progressWorth : t.ui.forecast.progress}
        aside={
          <nav aria-label={t.ui.forecast.horizon} className="liquid seg">
            {HORIZONS.map((h) => (
              <StepLink
                key={h}
                href={`/forecast?months=${h}`}
                current={h === months}
                className="seg-item inline-flex min-h-9 min-w-9 items-center justify-center px-2.5 text-sm font-semibold"
              >
                {h}
              </StepLink>
            ))}
          </nav>
        }
      >
        {p.incomeMissing ? (
          <div className="glass p-4">
            <p className="font-semibold">{t.ui.forecast.needIncomeTitle}</p>
            <p className="text-ink-muted mt-1 text-[15px]">{t.ui.forecast.needIncomeBody}</p>
          </div>
        ) : (
          <div className="glass p-3">
            <PrognoseChart
              points={p.points}
              currentMonth={today.slice(0, 7)}
              balance={p.hasBalance}
            />
          </div>
        )}
        {p.lowConfidence && (
          <p className="text-ink-muted mt-3 px-2 text-sm">
            <strong className="text-ink font-semibold">{t.ui.forecast.note}</strong>{" "}
            {p.lowConfidence}
          </p>
        )}
      </Section>
      {btw.hasData && (
        <Section title={t.ui.btw.title(btw.quarter.label.replace("-", " "))} aside={t.ui.btw.aside}>
          <BtwCard btw={btw} t={t} locale={locale} />
        </Section>
      )}
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
