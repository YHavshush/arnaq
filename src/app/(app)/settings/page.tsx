import { eq } from "drizzle-orm";
import { Download } from "lucide-react";
import { Suspense } from "react";
import { schema } from "@/db";
import { GhostButton } from "@/components/arnaq/form";
import { pageDb } from "@/lib/auth/request";
import { currentUser } from "@/lib/auth/session";
import { MoodSetter } from "@/components/arnaq/mood";
import { PageHeader, Section } from "@/components/arnaq/page-header";
import { ChangePasswordForm } from "@/components/arnaq/auth-forms";
import { EraseData } from "@/components/arnaq/erase-data";
import { LearnedShops } from "@/components/arnaq/learned-shops";
import { AppearanceSettings } from "@/components/arnaq/appearance-settings";
import { BtwClients, BtwSettings } from "@/components/arnaq/btw-settings";
import { SavingsGoal } from "@/components/arnaq/savings-goal";
import { RestoreBackup } from "@/components/arnaq/restore-backup";
import { SmartSettings } from "@/components/arnaq/smart-settings";
import { RulesManager } from "@/components/arnaq/rules-manager";
import { HeroSkeleton } from "@/components/arnaq/states";
import { getI18n } from "@/i18n/server";
import { requestTime, todayIso } from "@/lib/api";
import { categoryLabel } from "@/lib/view/categories";
import { sortRules } from "@/lib/categories/categorise";
import { getBtwClients } from "@/lib/btw/clients";
import { getBtwSettings } from "@/lib/btw/settings";
import { getSavingsSettings } from "@/lib/savings/settings";
import { goalSaved } from "@/lib/btw/pot";
import { getSavingsSummary } from "@/lib/savings/summary";
import { SavingsProgress } from "@/components/arnaq/savings-progress";
import { messages } from "@/i18n/messages";
import { formatter } from "@/lib/view/format";
import { splitLabelKey } from "@/lib/smart/learned";
import { PROVIDERS } from "@/lib/smart/providers";
import { getSmartSettings, isEntitled } from "@/lib/smart/settings";

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
  const { locale, t } = await getI18n();
  const s = t.ui.settings;
  const [rules, categories, labels, smart, savingsSettings, savingsNow, btwSettings, btwClients] =
    await pageDb(async (db) => [
      await db.select().from(schema.categorisationRules),
      await db.select().from(schema.categories).orderBy(schema.categories.sortOrder),
      await db.select().from(schema.merchantLabels).where(eq(schema.merchantLabels.source, "user")),
      await getSmartSettings(db),
      await getSavingsSettings(db),
      await getSavingsSummary(db, { today: todayIso() }),
      await getBtwSettings(db),
      await getBtwClients(db),
    ]);
  const tiles = messages[locale].view.overzicht.tiles.sparen;
  const { euro } = formatter(locale);
  const goal = savingsSettings.goal;
  // The BTW pot inside the savings is owed, not goal money (see goalSaved).
  const forGoal = goalSaved(savingsNow);
  const reached = goal !== null && forGoal >= goal;
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
        <details className="glass mt-3">
          <summary className="min-h-11 cursor-pointer px-4 py-3 text-[15px] font-semibold">
            {t.auth.change.title}
          </summary>
          <div className="px-4 pb-4">
            <ChangePasswordForm />
          </div>
        </details>
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

      <Section title={s.appearance}>
        <AppearanceSettings />
      </Section>

      <Section title={s.savings.title}>
        {goal !== null && (
          <SavingsProgress
            variant="card"
            toGo={s.savings.toGo(euro(Math.max(goal - forGoal, 0)))}
            className="mb-3"
            label={s.savings.title}
            word={reached ? tiles.wordReached : tiles.wordUnderway}
            sub={tiles.subOf(euro(forGoal), euro(goal))}
            saved={forGoal}
            target={goal}
            tone={reached ? "good" : "accent"}
          />
        )}
        {btwSettings.potInSavings && (
          <p className="text-ink-muted mb-3 max-w-[56ch] px-1 text-[15px]">{s.savings.potNote}</p>
        )}
        <SavingsGoal
          goal={savingsSettings.goal}
          start={savingsSettings.start}
          anchor={savingsSettings.anchor}
          anchorDate={savingsSettings.anchorDate}
        />
      </Section>

      <Section title={t.ui.btw.settings.title}>
        <div className="grid gap-5">
          <section className="grid gap-2" aria-labelledby="btw-clients">
            <h3 id="btw-clients" className="text-ink-muted px-1 text-sm font-semibold">
              {t.ui.btw.settings.clientsTitle}
            </h3>
            <BtwClients clients={btwClients} />
          </section>
          <section className="grid gap-2" aria-labelledby="btw-money">
            <h3 id="btw-money" className="text-ink-muted px-1 text-sm font-semibold">
              {t.ui.btw.settings.settingsTitle}
            </h3>
            <BtwSettings pocket={btwSettings.pocket} potInSavings={btwSettings.potInSavings} />
          </section>
        </div>
      </Section>

      {/* Smart sorting has no provider yet: showing a consent flow for a feature that cannot run would only confuse. */}
      {Object.keys(PROVIDERS).length > 0 && (
        <Section title={s.smart.title}>
          <SmartSettings
            provider={smart.provider}
            entitled={isEntitled(user.id)}
            available={PROVIDERS.claude !== undefined}
          />
        </Section>
      )}

      <Section title={s.restore.title}>
        <RestoreBackup />
      </Section>

      <Section title={s.erase.title}>
        <EraseData />
      </Section>

      <details className="group mt-8">
        <summary className="font-display flex min-h-11 cursor-pointer list-none items-baseline justify-between gap-3 px-1 text-2xl font-medium tracking-tight">
          {s.advanced}
          <span className="text-ink-muted text-sm font-normal group-open:hidden">
            {s.advancedHint}
          </span>
        </summary>
        <Section title={s.rules} aside={s.rulesAside(rules.length)}>
          <RulesManager
            rules={sortRules(rules).map((r) => ({
              id: r.id,
              pattern: r.pattern,
              priority: r.priority,
              categoryName: name.get(r.categoryId) ?? s.unknownCategory,
            }))}
            categories={categories.filter((c) => c.type === "expense" || c.type === "income")}
          />
        </Section>
        <Section title={s.learned.title} aside={s.learned.aside(labels.length)}>
          <LearnedShops
            shops={labels
              .filter((l) => l.categoryId !== null)
              .map((l) => {
                const { key, direction } = splitLabelKey(l.merchantKey);
                return {
                  id: l.id,
                  key,
                  direction,
                  categoryName: name.get(l.categoryId!) ?? "",
                  categoryLabel: categoryLabel(name.get(l.categoryId!) ?? "", locale),
                };
              })}
          />
        </Section>
      </details>
    </div>
  );
}
