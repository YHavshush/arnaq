import Link from "next/link";
import { Suspense } from "react";
import { pageDb } from "@/lib/auth/request";
import { BtwCard } from "@/components/arnaq/btw-card";
import { StepLink } from "@/components/arnaq/step-link";
import { AheadTop } from "@/components/arnaq/ahead-top";
import { WorthBar } from "@/components/arnaq/worth-bar";
import { MonthList } from "@/components/arnaq/month-list";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader, Section } from "@/components/arnaq/page-header";
import { PrognoseChart } from "@/components/arnaq/prognose-chart";
import { EmptyState, HeroSkeleton } from "@/components/arnaq/states";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { getBtwSummary } from "@/lib/btw/summary";
import { formatter } from "@/lib/view/format";
import { HORIZONS, loadNetWorth, loadPrognose, parseHorizon } from "@/lib/view/load";
import { netWorthParts } from "@/lib/view/net-worth-parts";

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
  const query = await searchParams;
  const months = parseHorizon(query.months);
  const { p, btw, worth } = await pageDb(async (db) => {
    return {
      // One way of working it out: the budget where you set one (carried forward), your average for the rest.
      p: await loadPrognose(db, today, months, locale, "budget"),
      btw: await getBtwSummary(db, { today }),
      worth: await loadNetWorth(db, today),
    };
  });
  // The bar shows the money there is. The BTW (what is set aside minus what is still owed) takes money off, so it
  // has no width: it is listed under the bar, and the total next to the bar already includes it.
  const parts = [
    ...netWorthParts(worth, t.ui.netWorth.savingsName),
    ...(worth.btw.net !== 0
      ? [
          {
            key: "btw",
            name: worth.btw.net < 0 ? t.ui.netWorth.btwOwed : t.ui.netWorth.btwSpare,
            amount: worth.btw.net,
            share: 0,
          },
        ]
      : []),
  ];

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
      <AheadTop
        tone={p.tone}
        value={p.share}
        ringLabel={t.ui.forecast.ring(p.inThePlus, p.ahead)}
        amount={p.netWorth && !p.incomeMissing ? f.euro(p.netWorth.end) : f.euroSigned(p.growth)}
        caption={
          p.incomeMissing
            ? t.ui.forecast.captionSpend(p.points.at(-1)?.label ?? "")
            : p.netWorth
              ? t.ui.forecast.captionWorth(p.points.at(-1)?.label ?? "")
              : t.ui.forecast.caption(p.points.at(-1)?.label ?? "")
        }
        pill={
          p.dipMonths > 0 && !p.incomeMissing
            ? { text: t.ui.forecast.dipPill(p.dipMonths), good: false }
            : p.netWorth && !p.incomeMissing
              ? {
                  // The change of the net worth line (which also takes off the BTW taken on), so the pill and the chart agree.
                  text: t.ui.forecast.growthPill(
                    f.euroSigned(p.netWorth.end - p.netWorth.start),
                    months,
                  ),
                  good: p.netWorth.end - p.netWorth.start >= 0,
                }
              : undefined
        }
        sentence={p.sentence}
      >
        {worth.hasAny && !p.incomeMissing && (
          <WorthBar
            parts={parts}
            label={t.ui.netWorth.where}
            total={f.euro(worth.total)}
            totalLabel={t.ui.netWorth.now}
            format={f.euro}
          />
        )}
      </AheadTop>
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
          <span className="flex flex-wrap items-center justify-end gap-2">
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
          </span>
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
