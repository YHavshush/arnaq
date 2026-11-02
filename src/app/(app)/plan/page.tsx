import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader } from "@/components/arnaq/page-header";
import { PlanScreen } from "@/components/arnaq/plan-grid";
import { EmptyState, HeroSkeleton } from "@/components/arnaq/states";
import { StepLink } from "@/components/arnaq/step-link";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { pageDb } from "@/lib/auth/request";
import { HORIZONS, parseHorizon } from "@/lib/view/load";
import { loadPlan } from "@/lib/view/plan";
import { planHasRows } from "@/lib/view/plan-grid";

export default function PlanPage({ searchParams }: PageProps<"/plan">) {
  return (
    <Suspense fallback={<HeroSkeleton screen="plan" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/plan">, "searchParams">) {
  await requestTime();
  const { t } = await getI18n();
  const text = t.ui.plan;
  const months = parseHorizon((await searchParams).months);
  // The same basis as Ahead: the budget where one is set (carried forward), the average for the rest.
  const plan = await pageDb((db) => loadPlan(db, todayIso(), { months, basis: "budget" }));

  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <Link
        href={`/forecast?months=${months}`}
        className="text-accent -ml-1 inline-flex min-h-11 items-center gap-1 rounded-full pr-3 text-sm font-semibold"
      >
        <ChevronLeft className="size-4" aria-hidden />
        {text.back}
      </Link>
      <PageHeader title={text.title} sub={text.sub(months)} />
      {planHasRows(plan) ? (
        <>
          <div className="mb-3 flex justify-end">
            <nav aria-label={text.horizon} className="liquid seg">
              {HORIZONS.map((h) => (
                <StepLink
                  key={h}
                  href={`/plan?months=${h}`}
                  current={h === months}
                  className="seg-item inline-flex min-h-9 min-w-9 items-center justify-center px-2.5 text-sm font-semibold"
                >
                  {h}
                </StepLink>
              ))}
            </nav>
          </div>
          <PlanScreen plan={plan} />
        </>
      ) : (
        <EmptyState
          title={text.emptyTitle}
          action={{ href: "/upload", label: t.ui.common.uploadStatement }}
        >
          {text.emptyBody}
        </EmptyState>
      )}
    </div>
  );
}
