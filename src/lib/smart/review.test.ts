import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb, one, schema } from "@/db";
import { applyAutomatic } from "./auto";
import { confirmAutomatic, getAutomatic, undoAutomatic } from "./review";

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
          importHash: `h${n++}`,
          ...extra,
        })
        .returning(),
    ))!;
  const get = async (id: number) =>
    (await one(db.select().from(schema.transactions).where(eq(schema.transactions.id, id))))!;
  return { db, tx, get };
}

describe("the automatic list", () => {
  it("lists machine-made categories, newest first, and not the person's own", async () => {
    const { db, tx } = await setup();
    await tx("Lidl", { date: "2026-10-01" });
    await tx("Jumbo", { date: "2026-10-09" });
    await tx("Bakker Piet", { date: "2026-10-10" }); // unknown: not automatic
    await applyAutomatic(db);
    const { rows, total } = await getAutomatic(db);
    expect(total).toBe(2);
    expect(rows.map((r) => r.counterparty)).toEqual(["Jumbo", "Lidl"]);
  });

  it("undo clears the category, marks it undone and automation leaves it alone afterwards", async () => {
    const { db, tx, get } = await setup();
    const lidl = await tx("Lidl");
    await applyAutomatic(db);
    expect((await get(lidl.id)).categorySource).toBe("catalog");
    expect(await undoAutomatic(db, lidl.id)).toBe(true);
    expect(await get(lidl.id)).toMatchObject({ categoryId: null, categorySource: "undone" });
    expect((await applyAutomatic(db)).applied).toBe(0);
    expect((await get(lidl.id)).categoryId).toBeNull();
  });

  it("undo does not touch the person's own choice", async () => {
    const { db, tx, get } = await setup();
    const own = await tx("Lidl", { categoryId: 1, categorySource: "user" });
    expect(await undoAutomatic(db, own.id)).toBe(false);
    expect(await get(own.id)).toMatchObject({ categoryId: 1, categorySource: "user" });
    expect(await undoAutomatic(db, 99999)).toBe(false);
  });

  it("all correct approves the automatic ones, and only those", async () => {
    const { db, tx, get } = await setup();
    const a = await tx("Lidl");
    const b = await tx("Jumbo");
    const own = await tx("Bakker", { categoryId: 1, categorySource: "user" });
    await applyAutomatic(db);
    expect(await confirmAutomatic(db, [a.id, own.id])).toBe(1);
    expect((await get(a.id)).categorySource).toBe("confirmed");
    expect((await get(b.id)).categorySource).toBe("catalog");
    expect((await get(own.id)).categorySource).toBe("user");
    expect(await confirmAutomatic(db, [])).toBe(0);
    // A confirmed choice now counts as evidence for the history layer.
    expect((await getAutomatic(db)).total).toBe(1);
  });
});
