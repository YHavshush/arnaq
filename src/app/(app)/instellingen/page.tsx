import { Download } from "lucide-react";
import { Suspense } from "react";
import { getDb, schema } from "@/db";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader, Section } from "@/components/kasboek/page-header";
import { RulesManager } from "@/components/kasboek/rules-manager";
import { HeroSkeleton } from "@/components/kasboek/states";
import { requestTime } from "@/lib/api";
import { sortRules } from "@/lib/categories/categorise";

export default function InstellingenPage() {
  return (
    <Suspense fallback={<HeroSkeleton label="Instellingen worden geladen" />}>
      <Content />
    </Suspense>
  );
}

const download =
  "glass inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold";

async function Content() {
  await requestTime();
  const db = await getDb();
  const [rules, categories] = await Promise.all([
    db.select().from(schema.categorisationRules),
    db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
  ]);
  const name = new Map(categories.map((c) => [c.id, c.name]));
  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader title="Instellingen" sub="Je gegevens en je regels" />

      <Section title="Back-up">
        <p className="text-ink-muted mb-3 max-w-[52ch] px-1 text-[15px]">
          Bewaar een kopie van alles wat Kasboek van je weet. De back-up is één bestand dat je zelf
          bewaart; de lijst met transacties past in een spreadsheet.
        </p>
        <div className="flex flex-wrap gap-3">
          <a href="/api/export" download className={download}>
            <Download className="size-4" /> Volledige back-up (JSON)
          </a>
          <a href="/api/export/csv" download className={download}>
            <Download className="size-4" /> Transacties (CSV)
          </a>
        </div>
      </Section>

      <Section title="Sorteerregels" aside={`${rules.length} regels`}>
        <RulesManager
          rules={sortRules(rules).map((r) => ({
            id: r.id,
            pattern: r.pattern,
            priority: r.priority,
            categoryName: name.get(r.categoryId) ?? "Onbekend",
          }))}
          categories={categories.filter((c) => c.type !== "transfer")}
        />
      </Section>
    </div>
  );
}
