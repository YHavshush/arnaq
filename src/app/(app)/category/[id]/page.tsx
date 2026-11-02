import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { pageDb } from "@/lib/auth/request";
import { CategoryTransactions } from "@/components/arnaq/category-transactions";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader } from "@/components/arnaq/page-header";
import { EmptyState, HeroSkeleton } from "@/components/arnaq/states";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { loadCategoryDetail } from "@/lib/view/category-detail";
import { categoryLabel } from "@/lib/view/categories";
import { formatter } from "@/lib/view/format";
import { parseMonth } from "@/lib/view/load";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default function CategoryPage(props: Props) {
  return (
    <Suspense fallback={<HeroSkeleton screen="overview" />}>
      <Content {...props} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: Props) {
  await requestTime();
  const { locale, t } = await getI18n();
  const f = formatter(locale);
  const c = t.ui.category;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const month = parseMonth((await searchParams).month, todayIso().slice(0, 7));
  const d = await pageDb((db) => loadCategoryDetail(db, id, month, { today: todayIso() }));
  if (!d) notFound();

  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader
        title={categoryLabel(d.category.name, locale)}
        sub={
          <Link href={`/?month=${month}`} className="hover:underline">
            {c.back} · {f.monthName(month)}
          </Link>
        }
        step={{
          prev: `/category/${id}?month=${d.prev}`,
          next: `/category/${id}?month=${d.next}`,
          prevLabel: t.ui.step.to(f.monthName(d.prev)),
          nextLabel: t.ui.step.to(f.monthName(d.next)),
        }}
      />
      <div className="glass mb-4 grid gap-1 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <span className="num font-display text-[32px] leading-none">{f.euroExact(d.total)}</span>
          {d.budget !== null && (
            <span className="text-ink-muted text-sm">{c.ofBudget(f.euro(d.budget))}</span>
          )}
        </div>
        <p className="text-ink-muted text-sm">
          {d.over > 0 && (
            <span className="text-bad font-semibold">{c.over(f.euro(d.over))} · </span>
          )}
          {c.count(d.count)}
        </p>
      </div>
      {d.rows.length === 0 ? (
        <EmptyState title={categoryLabel(d.category.name, locale)}>{c.empty}</EmptyState>
      ) : (
        <CategoryTransactions
          rows={d.rows}
          categoryName={d.category.name}
          categories={d.categories}
          special={d.special}
          currentId={id}
        />
      )}
    </div>
  );
}
