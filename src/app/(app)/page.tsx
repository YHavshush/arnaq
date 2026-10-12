import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db";
import { Hero } from "@/components/kasboek/hero";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader, Section } from "@/components/kasboek/page-header";
import { Row } from "@/components/kasboek/row";
import { EmptyState, HeroSkeleton } from "@/components/kasboek/states";
import { StatusTile } from "@/components/kasboek/status-tile";
import { requestTime, todayIso } from "@/lib/api";
import { dayLabel, euro, monthName } from "@/lib/view/format";
import { loadOverzicht, parseMonth } from "@/lib/view/load";
import type { OverzichtRow } from "@/lib/view/overzicht";

export default function Overzicht({ searchParams }: PageProps<"/">) {
  return (
    <Suspense fallback={<HeroSkeleton label="Overzicht wordt geladen" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

function rowProps(r: OverzichtRow) {
  const onlyPlanned = r.actual === 0 && r.planned > 0;
  return {
    icon: r.name === "Zonder categorie" ? null : r.name,
    name: r.name,
    meta:
      r.planned > 0 && !onlyPlanned
        ? `nog ${euro(r.planned)} gepland`
        : r.budget !== null && !onlyPlanned
          ? `${euro(Math.max(r.budget - r.actual, 0))} over`
          : undefined,
    amount: euro(onlyPlanned ? r.planned : r.actual),
    amountSub: onlyPlanned
      ? `komt ${dayLabel(r.nextDate!)}`
      : r.budget !== null
        ? `van ${euro(r.budget)}`
        : undefined,
    bar:
      r.budget !== null && r.budget > 0
        ? { filled: r.actual / r.budget, planned: r.planned / r.budget, state: r.state }
        : undefined,
  };
}

async function Content({ searchParams }: Pick<PageProps<"/">, "searchParams">) {
  await requestTime();
  const today = todayIso();
  const month = parseMonth((await searchParams).maand, today.slice(0, 7));
  const o = await loadOverzicht(await getDb(), month, today);
  const step = {
    prev: `/?maand=${o.prev}`,
    next: `/?maand=${o.next}`,
    prevLabel: `Naar ${monthName(o.prev)}`,
    nextLabel: `Naar ${monthName(o.next)}`,
  };

  if (!o.hasActivity)
    return (
      <>
        <MoodSetter mood="neutral" />
        <PageHeader title="Overzicht" sub={monthName(month)} step={step} />
        <EmptyState
          title={`Nog niets in ${monthName(month)}`}
          action={{ href: "/upload", label: "Afschrift uploaden" }}
        >
          Upload een afschrift van je bank om te zien hoe deze maand ervoor staat. Je kunt daarna
          een budget instellen.
        </EmptyState>
      </>
    );

  const shown = o.rows.slice(0, 8);
  const rest = o.rows.slice(8);
  return (
    <div className="fade-in">
      <MoodSetter mood={o.mood} />
      <PageHeader title="Overzicht" sub={monthName(month)} step={step} />
      <div className="@min-[900px]/app:grid @min-[900px]/app:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] @min-[900px]/app:items-center @min-[900px]/app:gap-8">
        <Hero
          tone={o.tone}
          value={o.used ?? (o.spent > 0 ? 1 : 0)}
          ringLabel={
            o.used === null
              ? "Geen budget ingesteld"
              : `${Math.round(o.used * 100)}% van het budget gebruikt of gepland`
          }
          centre={o.free === null ? euro(o.spent) : euro(o.free)}
          caption={o.free === null ? "uitgegeven" : o.free < 0 ? "over je budget" : "nog vrij"}
          sentence={o.sentence}
        />
        <div className="mt-6 grid grid-cols-2 gap-3 @min-[900px]/app:mt-0">
          {o.tiles.map((t) => (
            <StatusTile key={t.key} tile={t} />
          ))}
        </div>
      </div>

      <Section
        title="Uitgaven"
        aside={
          <Link href={`/budget?maand=${month}`} className="text-accent font-semibold">
            Budget instellen
          </Link>
        }
      >
        {o.rows.length === 0 ? (
          <p className="glass text-ink-muted px-4 py-6 text-center text-[15px]">
            Geen uitgaven in deze maand.
          </p>
        ) : (
          <div className="glass overflow-hidden">
            <ul className="divide-hair divide-y">
              {shown.map((r) => (
                <Row key={r.categoryId ?? "none"} {...rowProps(r)} />
              ))}
            </ul>
            {rest.length > 0 && (
              <details className="border-hair group border-t">
                <summary className="text-accent min-h-11 cursor-pointer list-none px-4 py-3 text-center text-[15px] font-semibold group-open:hidden">
                  Toon nog {rest.length}
                </summary>
                <ul className="divide-hair divide-y">
                  {rest.map((r) => (
                    <Row key={r.categoryId ?? "none"} {...rowProps(r)} />
                  ))}
                </ul>
              </details>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
