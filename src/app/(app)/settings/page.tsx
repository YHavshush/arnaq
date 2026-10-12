import { Download } from "lucide-react";
import { Suspense } from "react";
import { schema } from "@/db";
import { GhostButton } from "@/components/kasboek/form";
import { pageDb } from "@/lib/auth/request";
import { currentUser } from "@/lib/auth/session";
import { MoodSetter } from "@/components/kasboek/mood";
import { PageHeader, Section } from "@/components/kasboek/page-header";
import { RulesManager } from "@/components/kasboek/rules-manager";
import { HeroSkeleton } from "@/components/kasboek/states";
import { getI18n } from "@/i18n/server";
import { requestTime } from "@/lib/api";
import { sortRules } from "@/lib/categories/categorise";

export default function SettingsPage() {
  return (
    <Suspense fallback={<HeroSkeleton screen="settings" />}>
      <Content />
    </Suspense>
  );
}

const download =
  "glass inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-[15px] font-semibold";

async function Content() {
  await requestTime();
  const { t } = await getI18n();
  const s = t.ui.settings;
  const [rules, categories] = await pageDb(async (db) => [
    await db.select().from(schema.categorisationRules),
    await db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
  ]);
  const name = new Map(categories.map((c) => [c.id, c.name]));
  const user = await currentUser(); // pageDb above already sent anyone signed out to the login
  return (
    <div className="fade-in">
      <MoodSetter mood="neutral" />
      <PageHeader title={s.title} sub={s.sub} />

      <Section title={t.auth.account.title}>
        <div className="glass flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="min-w-0 text-[15px] break-words">
            {user.email ? t.auth.account.signedInAs(user.email) : t.auth.account.signedIn}
          </p>
          <form action="/auth/logout" method="post">
            <GhostButton type="submit">{t.auth.account.signOut}</GhostButton>
          </form>
        </div>
      </Section>

      <Section title={s.backup}>
        <p className="text-ink-muted mb-3 max-w-[52ch] px-1 text-[15px]">{s.backupBody}</p>
        <div className="flex flex-wrap gap-3">
          <a href="/api/export" download className={download}>
            <Download className="size-4" /> {s.backupFull}
          </a>
          <a href="/api/export/csv" download className={download}>
            <Download className="size-4" /> {s.backupCsv}
          </a>
        </div>
      </Section>

      <Section title={s.rules} aside={s.rulesAside(rules.length)}>
        <RulesManager
          rules={sortRules(rules).map((r) => ({
            id: r.id,
            pattern: r.pattern,
            priority: r.priority,
            categoryName: name.get(r.categoryId) ?? s.unknownCategory,
          }))}
          categories={categories.filter((c) => c.type !== "transfer")}
        />
      </Section>
    </div>
  );
}
