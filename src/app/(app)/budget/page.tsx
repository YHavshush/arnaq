import { Suspense } from "react";
import { getDb } from "@/db";
import { BudgetEditor } from "@/components/kasboek/budget-editor";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader } from "@/components/kasboek/page-header";
import { HeroSkeleton } from "@/components/kasboek/states";
import { requestTime, todayIso } from "@/lib/api";
import { getMonthOverview } from "@/lib/budget/overview";
import { addMonths } from "@/lib/recurring/dates";
import { monthName } from "@/lib/view/format";
import { parseMonth } from "@/lib/view/load";

export default function BudgetPage({ searchParams }: PageProps<"/budget">) {
  return (
    <Suspense fallback={<HeroSkeleton label="Budget wordt geladen" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/budget">, "searchParams">) {
  await requestTime();
  const month = parseMonth((await searchParams).maand, todayIso().slice(0, 7));
  const o = await getMonthOverview(await getDb(), month);
  const prev = addMonths(month, -1);
  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader
        title="Budget"
        sub={monthName(month)}
        step={{
          prev: `/budget?maand=${prev}`,
          next: `/budget?maand=${addMonths(month, 1)}`,
          prevLabel: `Naar ${monthName(prev)}`,
          nextLabel: `Naar ${monthName(addMonths(month, 1))}`,
        }}
      />
      <p className="text-ink-muted mb-4 max-w-[52ch] px-1 text-[15px]">
        Stel per categorie in hoeveel je maximaal wilt uitgeven. Een bedrag wordt bewaard zodra je
        het veld verlaat. Je vaste lasten tellen hier gewoon in mee.
      </p>
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
