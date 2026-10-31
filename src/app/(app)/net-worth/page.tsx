import { Suspense } from "react";
import Link from "next/link";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader, Section } from "@/components/arnaq/page-header";
import { EmptyState, HeroSkeleton } from "@/components/arnaq/states";
import { getI18n } from "@/i18n/server";
import { pageDb } from "@/lib/auth/request";
import { requestTime, todayIso } from "@/lib/api";
import { formatter } from "@/lib/view/format";
import { loadNetWorth } from "@/lib/view/load";

export default function NetWorthPage() {
  return (
    <Suspense fallback={<HeroSkeleton screen="settings" />}>
      <Content />
    </Suspense>
  );
}

function Line({
  label,
  sub,
  value,
  strong,
}: {
  label: string;
  sub?: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-4 px-4 py-3">
      <div className="min-w-0">
        <div className={`truncate text-base ${strong ? "font-semibold" : ""}`}>{label}</div>
        {sub && <div className="text-ink-muted text-[13px]">{sub}</div>}
      </div>
      <div className={`num text-base ${strong ? "font-semibold" : ""}`}>{value}</div>
    </li>
  );
}

async function Content() {
  await requestTime();
  const { locale, t } = await getI18n();
  const n = t.ui.netWorth;
  const f = formatter(locale);
  const w = await pageDb((db) => loadNetWorth(db, todayIso()));

  if (!w.hasAny)
    return (
      <>
        <MoodSetter mood="neutral" />
        <PageHeader title={n.pageTitle} sub={n.sub} />
        <EmptyState
          title={n.emptyTitle}
          action={{ href: "/upload", label: t.ui.common.uploadStatement }}
        >
          {n.emptyBody}
        </EmptyState>
      </>
    );

  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader
        title={n.pageTitle}
        sub={
          <Link href="/forecast" className="hover:underline">
            {n.back}
          </Link>
        }
      />
      <div className="glass mb-4 p-4">
        <div className="num font-display text-[40px] leading-none">{f.euroExact(w.total)}</div>
        <p className="text-ink-muted mt-2 max-w-[56ch] text-[15px]">{n.intro}</p>
      </div>

      <Section
        title={n.accounts}
        aside={<span className="num">{f.euroExact(w.accountsTotal)}</span>}
      >
        <ul className="glass divide-hair divide-y overflow-hidden">
          {w.accounts.length === 0 ? (
            <li className="text-ink-muted px-4 py-3 text-[15px]">{n.noAccounts}</li>
          ) : (
            w.accounts.map((a) => (
              <Line
                key={a.accountId}
                label={a.name}
                sub={n.asOf(f.dayLabel(a.asOf))}
                value={f.euroExact(a.balance)}
              />
            ))
          )}
        </ul>
      </Section>

      <Section
        title={n.savings}
        aside={<span className="num">{f.euroExact(w.savings.saved)}</span>}
      >
        <ul className="glass divide-hair divide-y overflow-hidden">
          <Line
            label={w.savings.fromStatement ? n.savingsStatement : n.savingsTyped}
            sub={w.savings.baseDate ? n.asOf(f.dayLabel(w.savings.baseDate)) : undefined}
            value={f.euroExact(w.savings.base)}
          />
          <Line
            label={n.savingsSince}
            sub={n.savingsMoves(w.savings.moves)}
            value={f.euroExact(w.savings.since)}
          />
          <Line label={n.savingsNow} value={f.euroExact(w.savings.saved)} strong />
        </ul>
        <p className="text-ink-muted mt-2 max-w-[60ch] px-1 text-[13px]">{n.savingsNote}</p>
      </Section>

      {w.btwPocket > 0 && (
        <Section title={n.notCounted}>
          <ul className="glass divide-hair divide-y overflow-hidden">
            <Line label={n.btwPocket} sub={n.btwNote} value={f.euroExact(w.btwPocket)} />
          </ul>
        </Section>
      )}

      <Section title={n.total}>
        <ul className="glass divide-hair divide-y overflow-hidden">
          <Line label={n.accounts} value={f.euroExact(w.accountsTotal)} />
          <Line label={n.savings} value={f.euroExact(w.savings.saved)} />
          <Line label={n.total} value={f.euroExact(w.total)} strong />
        </ul>
      </Section>
    </div>
  );
}
