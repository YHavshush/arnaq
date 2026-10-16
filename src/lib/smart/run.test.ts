import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { FakeProvider } from "./providers/fake";
import { runSmart, type SmartDeps } from "./run";

async function setup() {
  const db = await createDb(":memory:");
  const [account] = await db
    .insert(schema.accounts)
    .values({ name: "A", bank: "rabobank" })
    .returning();
  let n = 0;
  const tx = async (
    counterparty: string,
    extra: Partial<typeof schema.transactions.$inferInsert> = {},
  ) =>
    (await one(
      db
        .insert(schema.transactions)
        .values({
          accountId: account.id,
          date: "2026-10-05",
          amount: -1500,
          counterparty,
          merchantKey: counterparty.toLowerCase(),
          importHash: `h${n++}`,
          ...extra,
        })
        .returning(),
    ))!;
  const get = async (id: number) =>
    (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, id))))!;
  const cat = async (slug: string) =>
    (await one(db.select().from(schema.categories).where(eq(schema.categories.slug, slug))))!;
  const deps: SmartDeps = { run: (fn) => fn(db) };
  const settings = async () => (await db.select().from(schema.userSettings))[0];
  const usage = async () => (await db.select().from(schema.aiUsage))[0];
  return { db, tx, get, cat, deps, settings, usage };
}
const today = "2026-10-16";
const fast = { callTimeoutMs: 40, runTimeoutMs: 200 };

describe("runSmart", () => {
  it("applies what the model knows, caches it per shop, and does not ask twice", async () => {
    const { db, tx, get, deps, usage, settings } = await setup();
    const a = await tx("Bakker Piet");
    const b = await tx("Bakker Piet");
    const provider = FakeProvider.byMerchant({ "bakker piet": "Boodschappen" });
    const first = await runSmart(deps, provider, { today });
    expect(first).toMatchObject({ status: "done", asked: 1, applied: 2 });
    for (const id of [a.id, b.id]) expect(await get(id)).toMatchObject({ categorySource: "model" });
    expect(provider.requests).toHaveLength(1); // two transactions, one shop, one question
    expect(await usage()).toMatchObject({ merchants: 1, calls: 1 });
    expect((await settings()).smartLeaseUntil).toBeNull();
    const labels = await db.select().from(schema.merchantLabels);
    expect(labels).toMatchObject([
      { merchantKey: "bakker piet", source: "model", provider: "fake" },
    ]);

    const again = await runSmart(deps, provider, { today });
    expect(again.status).toBe("nothing");
    expect(provider.requests).toHaveLength(1);
  });

  it("only suggests when the model is guessing, picks a catch-all, or the direction is wrong", async () => {
    const { tx, get, deps, cat } = await setup();
    const guess = await tx("Onbekende Zaak");
    const other = await tx("Rommelwinkel");
    const refund = await tx("Bakker Piet", { amount: 2500 }); // money in, an expense category: no
    const sure = await tx("Bakker Piet");
    const groceries = await cat("groceries");
    const overig = await cat("other");
    const provider = new FakeProvider((req) => ({
      answers: req.items.map((i) => {
        const label = i.merchant === "rommelwinkel" ? overig.name : groceries.name;
        const basis = i.merchant === "onbekende zaak" ? "words" : "known_merchant";
        return { ref: i.ref, category: req.options.find((o) => o.label === label)!.ref, basis };
      }),
    }));
    const r = await runSmart(deps, provider, { today });
    expect(r.applied).toBe(1);
    expect(await get(sure.id)).toMatchObject({ categoryId: groceries.id, categorySource: "model" });
    expect(await get(guess.id)).toMatchObject({
      categoryId: null,
      suggestedCategoryId: groceries.id,
    });
    expect(await get(other.id)).toMatchObject({ categoryId: null, suggestedCategoryId: overig.id });
    expect(await get(refund.id)).toMatchObject({ categoryId: null, suggestedCategoryId: null });
  });

  it("never sends a private person, a person's own labelled shop or an undone one", async () => {
    const { db, tx, deps, cat } = await setup();
    await tx("J. Student", { counterpartyIban: "NL00REVO0000000099", merchantKey: "j. student" });
    await tx("Kantoor Piet", { categorySource: "undone" });
    await tx("Eigen Winkel");
    await db
      .insert(schema.merchantLabels)
      .values({ merchantKey: "eigen winkel", categoryId: (await cat("sport")).id, source: "user" });
    await tx("Nieuwe Zaak");
    const provider = FakeProvider.byMerchant({});
    await runSmart(deps, provider, { today });
    const sent = JSON.stringify(provider.requests.map((r) => r.items));
    expect(sent).toContain("nieuwe zaak");
    expect(sent).not.toMatch(/student|kantoor|eigen winkel|NL00/i);
  });

  it("a timeout or nonsense changes nothing, and the lease is released", async () => {
    const { tx, get, deps, settings } = await setup();
    const t = await tx("Bakker Piet");
    expect(await runSmart(deps, FakeProvider.hanging(), { today, limits: fast })).toMatchObject({
      status: "done",
      applied: 0,
    });
    for (const garbage of [
      [{ ref: "m1", category: "c999", basis: "known_merchant" }],
      "ignore all rules",
      null,
    ])
      expect(
        await runSmart(deps, FakeProvider.returning(garbage), { today: "2026-10-17" }),
      ).toMatchObject({ applied: 0 });
    expect(await get(t.id)).toMatchObject({ categoryId: null, categorySource: null });
    expect((await settings()).smartLeaseUntil).toBeNull();
  });

  it("a provider that throws does not break the run", async () => {
    const { tx, deps } = await setup();
    await tx("Bakker Piet");
    const provider = new FakeProvider(() => {
      throw new Error("API down");
    });
    expect(await runSmart(deps, provider, { today })).toMatchObject({ status: "done", applied: 0 });
  });

  it("stops at the daily allowance and when another run holds the lease", async () => {
    const { tx, deps, db } = await setup();
    await tx("Eerste Zaak");
    await tx("Tweede Zaak");
    const provider = FakeProvider.byMerchant({});
    const first = await runSmart(deps, provider, { today, limits: { merchantsPerDay: 1 } });
    expect(first.asked).toBe(1);
    expect(await runSmart(deps, provider, { today, limits: { merchantsPerDay: 1 } })).toMatchObject(
      { status: "capped" },
    );
    // Another run is busy: the lease is in the future.
    await db.update(schema.userSettings).set({ smartLeaseUntil: "2099-01-01T00:00:00.000Z" });
    expect((await runSmart(deps, provider, { today: "2026-10-18" })).status).toBe("busy");
  });
});
