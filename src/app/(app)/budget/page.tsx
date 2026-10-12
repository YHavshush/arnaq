import { Suspense } from "react";
import { getDb } from "@/db";
import { BudgetEditor } from "@/components/kasboek/budget-editor";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader } from "@/components/kasboek/page-header";
import { HeroSkeleton } from "@/components/kasboek/states";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { getMonthOverview } from "@/lib/budget/overview";
import { addMonths } from "@/lib/recurring/dates";
import { formatter } from "@/lib/view/format";
import { parseMonth } from "@/lib/view/load";

export default function BudgetPage({ searchParams }: PageProps<"/budget">) {
  return (
    <Suspense fallback={<HeroSkeleton screen="budget" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/budget">, "searchParams">) {
  await requestTime();
  const { locale, t } = await getI18n();
  const { monthName } = formatter(locale);
  const month = parseMonth((await searchParams).month, todayIso().slice(0, 7));
  const o = await getMonthOverview(await getDb(), month);
  const prev = addMonths(month, -1);
  const next = addMonths(month, 1);
  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader
        title={t.ui.budget.title}
        sub={monthName(month)}
        step={{
          prev: `/budget?month=${prev}`,
          next: `/budget?month=${next}`,
          prevLabel: t.ui.step.to(monthName(prev)),
          nextLabel: t.ui.step.to(monthName(next)),
        }}
      />
      <p className="text-ink-muted mb-4 max-w-[52ch] px-1 text-[15px]">{t.ui.budget.intro}</p>
      <BudgetEditor
        month={month}
        prevMonth={prev}
        prevLabel={monthName(prev)}
        total={o.totals.totalBudgetIsExplicit ? o.totals.totalBudget : null}
        lines={o.expenses.map((l) => ({
          categoryId: l.categoryId!,
          name: l.name,
          budget: l.budget,
        }))}
      />
    </div>
  );
}
