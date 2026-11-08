import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { importStatement } from "@/lib/import/service";
import { setPlanOverride } from "@/lib/plan/overrides";
import { createRecurringItem } from "@/lib/recurring/items";
import { loadPlan } from "@/lib/view/plan";
import { localizeMessage } from "./server-messages";

describe("localizeMessage", () => {
  it("leaves English as it is and unknown messages untranslated", () => {
    expect(localizeMessage("Name is required.", "en")).toBe("Name is required.");
    expect(localizeMessage("Something nobody translated.", "nl")).toBe(
      "Something nobody translated.",
    );
  });

  it.each([
    ["Account 7 does not exist.", "Rekening 7 bestaat niet."],
    ['Invalid month "2026-13", use YYYY-MM.', 'Ongeldige maand "2026-13". Gebruik JJJJ-MM.'],
    [
      "This looks like a rabobank file but account 1 is revolut.",
      "Dit lijkt een Rabobank-bestand, maar de gekozen rekening is een Revolut-rekening.",
    ],
    [
      "Not a Rabobank export, missing: IBAN/BBAN, Datum",
      "Dit is geen Rabobank-export; er ontbreken kolommen: IBAN/BBAN, Datum",
    ],
    [
      "State PENDING, only COMPLETED is imported",
      "Status PENDING; alleen COMPLETED wordt geïmporteerd",
    ],
    [
      "2 row(s) are not in EUR; review them manually.",
      "2 regel(s) staan niet in EUR; kijk ze zelf na.",
    ],
    [
      "This statement belongs to a different account than the one chosen.",
      "Dit afschrift hoort bij een andere rekening dan de gekozen rekening.",
    ],
    [
      'Category "Zorgtoeslag" is not an expense category.',
      'Categorie "Zorgtoeslag" hoort niet bij een uitgave.',
    ],
    [
      "Start date must be between 1990-01-01 and 2100-12-31.",
      "De begindatum moet tussen 1990-01-01 en 2100-12-31 liggen.",
    ],
    ["At most 500 recurring items are supported.", "Er kunnen maximaal 500 vaste posten zijn."],
    [
      "A month that has passed cannot be planned.",
      "Een maand die voorbij is kun je niet meer plannen.",
    ],
    ["The plan goes up to 24 months ahead.", "Het plan gaat tot 24 maanden vooruit."],
    ["Unknown fixed item.", "Deze vaste post bestaat niet."],
    ["The payment lag must be 0, 1 or 2 months.", "De betaaltermijn moet 0, 1 of 2 maanden zijn."],
    [
      "The BTW pot setting must be on or off.",
      "De instelling voor de BTW-pot moet aan of uit staan.",
    ],
    ["File too large (max 4 MB).", "Dit bestand is te groot (maximaal 4 MB)."],
    [
      "The savings goal must be a positive amount.",
      "Het spaardoel moet een bedrag boven nul zijn.",
    ],
    [
      "The amount already saved cannot be negative.",
      "Het al gespaarde bedrag kan niet negatief zijn.",
    ],
  ])("translates %s", (english, dutch) => {
    expect(localizeMessage(english, "nl")).toBe(dutch);
  });

  it("covers the messages the code really throws (not just hand-written samples)", async () => {
    const db = await createDb(":memory:");
    const thrown = async (fn: () => Promise<unknown>) => {
      try {
        await fn();
      } catch (e) {
        return (e as Error).message;
      }
      throw new Error("expected an error");
    };
    const messages = [
      await thrown(() => importStatement(db, { content: "a,b\n1,2\n", filename: "x.csv" })),
      await thrown(() =>
        importStatement(db, { content: "a,b\n1,2\n", filename: "x.csv", accountId: 99 }),
      ),
      await thrown(() =>
        createRecurringItem(
          db,
          { name: " ", type: "expense", expectedAmount: 1, dayOfMonth: 1, startDate: "2026-01-01" },
          { today: "2026-10-12" },
        ),
      ),
      await thrown(() =>
        createRecurringItem(
          db,
          {
            name: "x",
            type: "expense",
            expectedAmount: 0,
            dayOfMonth: 1,
            startDate: "2026-01-01",
            matchCounterparty: "x",
          },
          { today: "2026-10-12" },
        ),
      ),
      // the plan grid
      await thrown(() => loadPlan(db, "2026-10-12", { months: 0, basis: "budget" })),
      ...(await Promise.all(
        [
          { kind: "tax", id: 1, month: "2026-10", amount: 1, scope: "month" },
          { kind: "category", id: 1, month: "2026-10", amount: 1, scope: "forever" },
          { kind: "category", id: 1, month: "2026-10", amount: -5, scope: "month" },
          { kind: "category", id: 1, month: "2026-09", amount: 1, scope: "month" },
          { kind: "category", id: 1, month: "2030-09", amount: 1, scope: "month" },
          { kind: "category", id: 99999, month: "2026-10", amount: 1, scope: "month" },
          { kind: "item", id: 99999, month: "2026-10", amount: 1, scope: "month" },
        ].map((input) => thrown(() => setPlanOverride(db, input, "2026-10-12"))),
      )),
    ];
    for (const m of messages) expect(localizeMessage(m, "nl"), m).not.toBe(m);
  });
});
