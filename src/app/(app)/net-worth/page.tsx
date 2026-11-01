import Link from "next/link";
import { Suspense } from "react";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader, Section } from "@/components/arnaq/page-header";
import { Row } from "@/components/arnaq/row";
import { EmptyState, HeroSkeleton } from "@/components/arnaq/states";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { pageDb } from "@/lib/auth/request";
import { formatter } from "@/lib/view/format";
import { loadNetWorth } from "@/lib/view/load";

export default function NetWorthPage() {
  return (
    <Suspense fallback={<HeroSkeleton screen="settings" />}>
      <Content />
    </Suspense>
  );
}

const BANK: Record<string, string> = { rabobank: "Rabobank", revolut: "Revolut" };
/** One colour per part, from the ring tokens: no new colours. */
const PART_COLOURS = [
  "var(--ring-accent-from)",
  "var(--ring-accent-to)",
  "var(--ring-good-to)",
  "var(--ring-warn-to)",
];

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

  // The parts: each checking account, then the savings. A part below zero has no width in the bar.
  const parts = [
    ...w.accounts.map((a) => ({
      key: `a${a.accountId}`,
      name: n.checking(BANK[a.bank] ?? a.name),
      sub: n.asOf(f.dayLabel(a.asOf)),
      amount: a.balance,
    })),
    ...(w.savings.saved !== 0 || w.savings.base > 0
      ? [
          {
            key: "savings",
            name: n.savingsName,
            sub: w.savings.baseDate ? n.asOf(f.dayLabel(w.savings.baseDate)) : n.savedSoFar,
            amount: w.savings.saved,
          },
        ]
      : []),
  ];
  const positive = parts.reduce((s, p) => s + Math.max(p.amount, 0), 0);
  const share = (amount: number) => (positive > 0 ? Math.max(amount, 0) / positive : 0);

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
      <div className="glass mb-4 grid gap-4 p-5">
        <div>
          <div className="text-ink-muted text-sm">{n.title}</div>
          <div className="num font-display text-[44px] leading-none font-medium">
            {f.euroExact(w.total)}
          </div>
        </div>
        <div
          role="img"
          aria-label={parts.map((p) => `${p.name} ${f.euroExact(p.amount)}`).join(", ")}
          className="flex h-4 gap-[3px] overflow-hidden rounded-full"
        >
          {parts.map((p, i) =>
            share(p.amount) > 0 ? (
              <i
                key={p.key}
                className="block h-full first:rounded-l-full last:rounded-r-full"
                style={{
                  width: `${share(p.amount) * 100}%`,
                  background: PART_COLOURS[i % PART_COLOURS.length],
                }}
              />
            ) : null,
          )}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {parts.map((p, i) => (
            <li key={p.key} className="inline-flex items-center gap-1.5">
              <i
                aria-hidden
                className="block size-2.5 rounded-full"
                style={{ background: PART_COLOURS[i % PART_COLOURS.length] }}
              />
              {p.name}
            </li>
          ))}
        </ul>
      </div>

      <Section title={n.parts}>
        <ul className="glass divide-hair divide-y overflow-hidden">
          {parts.map((p) => (
            <Row
              key={p.key}
              icon={p.key === "savings" ? "Spaarrekening" : null}
              name={p.name}
              meta={<span className="text-ink-muted text-[13px]">{p.sub}</span>}
              amount={f.euroExact(p.amount)}
              bar={{ filled: share(p.amount), state: "ok" }}
            />
          ))}
        </ul>
      </Section>
    </div>
  );
}
