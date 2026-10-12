import Link from "next/link";
import { Suspense } from "react";
import { getDb } from "@/db";
import { Hero } from "@/components/kasboek/hero";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader, Section } from "@/components/kasboek/page-header";
import { PrognoseChart } from "@/components/kasboek/prognose-chart";
import { EmptyState, HeroSkeleton } from "@/components/kasboek/states";
import { requestTime, todayIso } from "@/lib/api";
import { euroSigned } from "@/lib/view/format";
import { HORIZONS, loadPrognose, parseHorizon } from "@/lib/view/load";

export default function PrognosePage({ searchParams }: PageProps<"/prognose">) {
  return (
    <Suspense fallback={<HeroSkeleton label="Prognose wordt geladen" />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: Pick<PageProps<"/prognose">, "searchParams">) {
  await requestTime();
  const today = todayIso();
  const months = parseHorizon((await searchParams).maanden);
  const p = await loadPrognose(await getDb(), today, months);

  if (!p.hasForecast)
    return (
      <>
        <MoodSetter mood="neutral" />
        <PageHeader title="Prognose" sub="Hoe het er de komende maanden uitziet" />
        <EmptyState
          title="Nog niets te voorspellen"
          action={{ href: "/upload", label: "Afschrift uploaden" }}
        >
          Upload minstens een maand en voeg je vaste lasten toe. Daarna zie je hier hoe je geld zich
          ontwikkelt.
        </EmptyState>
      </>
    );

  return (
    <div className="fade-in">
      <MoodSetter mood={p.mood} />
      <PageHeader title="Prognose" sub={`De komende ${months} maanden`} />
      <Hero
        tone={p.tone}
        value={p.share}
        ringLabel={`${p.inThePlus} van ${p.ahead} maanden eindigen in de plus`}
        centre={euroSigned(p.growth)}
        caption={`groei tot en met ${p.points.at(-1)?.label}`}
        sentence={p.sentence}
      />
      <Section
        title="Verloop"
        aside={
          <nav
            aria-label="Aantal maanden vooruit"
            className="bg-track inline-flex rounded-xl p-0.5"
          >
            {HORIZONS.map((h) => (
              <Link
                key={h}
                href={`/prognose?maanden=${h}`}
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
            <strong className="text-ink font-semibold">Let op:</strong> {p.lowConfidence}
          </p>
        )}
      </Section>
    </div>
  );
}
