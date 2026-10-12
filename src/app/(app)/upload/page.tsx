import { Check } from "lucide-react";
import { Suspense } from "react";
import { getDb } from "@/db";
import { Hero } from "@/components/kasboek/hero";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader, Section } from "@/components/kasboek/page-header";
import { ReviewList } from "@/components/kasboek/review-list";
import { HeroSkeleton } from "@/components/kasboek/states";
import { UploadPanel } from "@/components/kasboek/upload-panel";
import { requestTime } from "@/lib/api";
import { dayLabel, monthName } from "@/lib/view/format";
import { loadUpload } from "@/lib/view/load";

export default function UploadPage() {
  return (
    <Suspense fallback={<HeroSkeleton label="Upload wordt geladen" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requestTime();
  const u = await loadUpload(await getDb());
  const done = u.reviewCount === 0;
  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader title="Upload" sub="Een afschrift per bank, per periode" />
      <Hero
        tone="accent"
        value={u.total === 0 ? 0 : u.share}
        ringLabel={`${u.sorted} van ${u.total} transacties gesorteerd`}
        centre={
          done && u.total > 0 ? (
            <Check className="mx-auto size-12" strokeWidth={2.5} aria-label="Klaar" />
          ) : (
            u.reviewCount
          )
        }
        caption={
          u.total === 0 ? "nog niets geüpload" : done ? "alles gesorteerd" : "nog te sorteren"
        }
        sentence={
          u.total === 0
            ? [{ text: "Upload je eerste afschrift om te beginnen." }]
            : done
              ? [
                  {
                    text: "Alles staat in een categorie. Upload de volgende maand zodra je die hebt.",
                  },
                ]
              : [{ text: "Kies bij elke transactie een categorie; ik onthoud je keuze." }]
        }
      />

      <Section title="Bestand uploaden">
        <UploadPanel accounts={u.accounts.map((a) => ({ id: a.id, name: a.name }))} />
      </Section>

      {u.review.length > 0 && (
        <Section title="Te sorteren" aside={`${u.reviewCount} open`}>
          <ReviewList
            items={u.review.map((t) => ({
              id: t.id,
              date: t.date,
              amount: t.amount,
              counterparty: t.counterparty,
              description: t.description,
              reason: t.reason,
              currency: t.currency,
            }))}
            categories={u.categories}
          />
          {u.reviewCount > u.review.length && (
            <p className="text-ink-muted mt-2 px-2 text-sm">
              De {u.review.length} nieuwste staan hier; de rest komt erna.
            </p>
          )}
        </Section>
      )}

      {u.imports.length > 0 && (
        <Section title="Eerder geüpload">
          <div className="glass overflow-hidden">
            <ul className="divide-hair divide-y">
              {u.imports.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {i.account},{" "}
                      {i.periodFrom && i.periodTo
                        ? `${dayLabel(i.periodFrom)} t/m ${dayLabel(i.periodTo)}`
                        : monthName(i.month)}
                    </div>
                    <div className="text-ink-muted truncate text-[13px]">{i.filename}</div>
                  </div>
                  <div className="num text-ink-muted shrink-0 text-sm">{i.rowsImported} nieuw</div>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}
    </div>
  );
}
