import { describe, expect, it } from "vitest";
import { merchantKey } from "./merchant";

describe("merchantKey", () => {
  const cases: [string | null, string | null, string][] = [
    // branch numbers, places and card bookkeeping
    ["Albert Heijn 1234 Zoetermeer", null, "albert heijn zoetermeer"],
    ["ALBERT HEIJN 5678 DELFT", null, "albert heijn delft"],
    ["Jumbo Supermarkten B.V.", null, "jumbo supermarkten"],
    ["Lidl Nederland GmbH", null, "lidl"],
    ["Lidl 4455 Pasnr 123", null, "lidl"],
    ["Café De Hoek", null, "cafe de hoek"],
    ["  cafe   de   hoek  ", null, "cafe de hoek"],
    ["Spotify AB", null, "spotify"],
    ["Netflix International B.V.", null, "netflix international"],
    ["Bol.com B.V.", null, "bol.com"],
    ["Etsy Ireland UK Ltd", null, "etsy ireland"],
    ["Shell Station NL", null, "shell station"],
    ["NS Reizigers 2026", null, "ns reizigers"],
    ["Starbucks Coffee Amsterdam Centraal Station", null, "starbucks coffee amsterdam"],
    // processors in front of the shop
    ["CCV*Bakkerij Van Dijk", null, "bakkerij van dijk"],
    ["CCV Bakkerij Van Dijk", null, "bakkerij van dijk"],
    ["SumUp  *Kapper Jansen", null, "kapper jansen"],
    ["Paypal *Etsy", null, "etsy"],
    ["PAYPAL *SPOTIFY", null, "spotify"],
    ["iZettle *Pizzeria Roma", null, "pizzeria roma"],
    ["Mollie *Festival Tickets", null, "festival tickets"],
    // the processor is all there is: the description has the shop
    ["CCV*", "Pizzeria Roma Utrecht", "pizzeria roma utrecht"],
    ["Paypal", "Etsy order 1234", "etsy order"],
    // nothing in the name: the description
    [null, "Boodschappen Lidl 1234", "boodschappen lidl"],
    ["", "Tikkie terug", "tikkie terug"],
    // nothing to go on
    [null, null, ""],
    ["", "", ""],
    ["1234 5678", null, ""],
    ["B.V.", null, ""],
  ];

  it.each(cases)("%j + %j -> %j", (counterparty, description, key) => {
    expect(merchantKey(counterparty, description)).toBe(key);
  });

  it("is the same for the same shop however it is written", () => {
    const keys = new Set(
      [
        "Albert Heijn",
        "ALBERT HEIJN",
        "albert  heijn",
        "Albert Heijn B.V.",
        "Albert Heijn 1234",
      ].map((n) => merchantKey(n)),
    );
    expect(keys.size).toBe(1);
  });

  it("keeps at most three words and never throws on odd input", () => {
    expect(merchantKey("a b c d e f g").split(" ")).toHaveLength(3);
    for (const odd of ["***", "\u0000", "💥", "x".repeat(10_000), "\n\t"])
      expect(() => merchantKey(odd, odd)).not.toThrow();
  });
});
