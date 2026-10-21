import { Check } from "lucide-react";
import { Suspense } from "react";
import { pageDb } from "@/lib/auth/request";
import { Hero } from "@/components/arnaq/hero";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader, Section } from "@/components/arnaq/page-header";
import { AutoList } from "@/components/arnaq/auto-list";
import { ReviewList } from "@/components/arnaq/review-list";
import { TransferList } from "@/components/arnaq/transfer-list";
import { HeroSkeleton } from "@/components/arnaq/states";
import { UploadPanel } from "@/components/arnaq/upload-panel";
import { getI18n } from "@/i18n/server";
import { requestTime } from "@/lib/api";
import { SAMPLE_IBAN } from "@/lib/sample/sample";
import { formatter } from "@/lib/view/format";
import { loadUpload } from "@/lib/view/load";

export default function UploadPage() {
  return (
    <Suspense fallback={<HeroSkeleton screen="upload" />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  await requestTime();
  const { locale, t } = await getI18n();
  const { dayLabel, monthName } = formatter(locale);
  const m = t.ui.upload;
  const u = await pageDb((db) => loadUpload(db));
  const done = u.reviewCount === 0;
  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader title={m.title} sub={m.sub} />
      <Hero
        tone="accent"
        value={u.total === 0 ? 0 : u.share}
        ringLabel={m.ring(u.sorted, u.total)}
        centre={
          done && u.total > 0 ? (
            <Check className="mx-auto size-12" strokeWidth={2.5} aria-label={m.done} />
          ) : (
            u.reviewCount
          )
        }
        caption={u.total === 0 ? m.captionNone : done ? m.captionDone : m.captionLeft}
        sentence={u.total === 0 ? m.sentenceNone() : done ? m.sentenceDone() : m.sentenceLeft()}
      />

      <Section title={m.sectionUpload}>
        <UploadPanel
          accounts={u.accounts
            .filter((a) => a.iban !== SAMPLE_IBAN) // the sample account is not a place to upload to
            .map((a) => ({ id: a.id, name: a.name }))}
        />
      </Section>

      {u.review.length > 0 && (
        <Section title={m.sectionSort} aside={m.sortAside(u.reviewCount)}>
          <ReviewList
            items={u.review.map((r) => ({
              id: r.id,
              date: r.date,
              amount: r.amount,
              counterparty: r.counterparty,
              description: r.description,
              reason: r.reason,
              currency: r.currency,
              suggestedCategoryId: r.suggestedCategoryId,
            }))}
            categories={u.categories}
            special={u.special}
            quick={u.quick}
          />
          {u.reviewCount > u.review.length && (
            <p className="text-ink-muted mt-2 px-2 text-sm">{m.sortMore(u.review.length)}</p>
          )}
        </Section>
      )}

      {u.automatic.rows.length > 0 && (
        <Section title={m.auto.title} aside={m.auto.aside(u.automatic.total)}>
          <AutoList
            items={u.automatic.rows.map((r) => ({
              id: r.id,
              date: r.date,
              amount: r.amount,
              counterparty: r.counterparty,
              description: r.description,
              categoryId: r.categoryId!,
            }))}
            categories={u.categories}
            special={u.special}
          />
          {u.automatic.total > u.automatic.rows.length && (
            <p className="text-ink-muted mt-2 px-2 text-sm">
              {m.auto.more(u.automatic.rows.length)}
            </p>
          )}
        </Section>
      )}

      {u.transfers.total > 0 && (
        <Section title={m.transfers.title} aside={m.transfers.aside(u.transfers.total)}>
          <TransferList
            items={u.transfers.rows.map((r) => ({
              id: r.id,
              date: r.date,
              amount: r.amount,
              counterparty: r.counterparty,
              description: r.description,
              source: r.categorySource,
              categoryName: u.special.find((c) => c.id === r.categoryId)?.name ?? null,
            }))}
            categories={u.categories}
            special={u.special}
          />
          {u.transfers.total > u.transfers.rows.length && (
            <p className="text-ink-muted mt-2 px-2 text-sm">
              {m.transfers.more(u.transfers.rows.length)}
            </p>
          )}
        </Section>
      )}

      {u.imports.length > 0 && (
        <Section title={m.sectionPrevious}>
          <div className="glass overflow-hidden">
            <ul className="divide-hair divide-y">
              {u.imports.map((i) => (
                <li key={i.id} className="flex items-baseline justify-between gap-3 px-4 py-3">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">
                      {i.account},{" "}
                      {i.periodFrom && i.periodTo
                        ? m.period(dayLabel(i.periodFrom), dayLabel(i.periodTo))
                        : monthName(i.month)}
                    </div>
                    <div className="text-ink-muted truncate text-[13px]">{i.filename}</div>
                  </div>
                  <div className="num text-ink-muted shrink-0 text-sm">
                    {m.newCount(i.rowsImported)}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      )}
    </div>
  );
}
