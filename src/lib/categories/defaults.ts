import type { CATEGORY_TYPES } from "@/db/schema";

type CategoryType = (typeof CATEGORY_TYPES)[number];

export const INTERNAL_TRANSFER_CATEGORY = "Interne overboeking";
export const SAVINGS_CATEGORY = "Spaarrekening";

/** Types whose transactions are neither income nor spending. */
export const isNonSpending = (type: CategoryType) => type === "transfer" || type === "savings";

/** Default categories (student, no kids, renting). Order here becomes sort order. */
export const DEFAULT_CATEGORIES: { slug: string; name: string; type: CategoryType }[] = [
  { slug: "rent", name: "Huur", type: "expense" },
  { slug: "utilities", name: "Gas, water, licht", type: "expense" },
  { slug: "internet-phone", name: "Internet & telefoon", type: "expense" },
  { slug: "health-insurance", name: "Zorgverzekering", type: "expense" },
  { slug: "groceries", name: "Boodschappen", type: "expense" },
  { slug: "eating-out", name: "Eten & drinken", type: "expense" },
  { slug: "going-out", name: "Uitgaan & social", type: "expense" },
  { slug: "transport", name: "Vervoer", type: "expense" },
  { slug: "sport", name: "Sport", type: "expense" },
  { slug: "subscriptions", name: "Abonnementen", type: "expense" },
  { slug: "study", name: "Studie", type: "expense" },
  { slug: "clothing-care", name: "Kleding & verzorging", type: "expense" },
  { slug: "health", name: "Gezondheid", type: "expense" },
  { slug: "travel", name: "Reizen & vakantie", type: "expense" },
  { slug: "gifts-donations", name: "Cadeaus & donaties", type: "expense" },
  { slug: "saving-investing", name: "Sparen & beleggen", type: "expense" },
  { slug: "other", name: "Overig", type: "expense" },
  { slug: "salary", name: "Salaris / bijbaan", type: "income" },
  { slug: "student-finance", name: "Studiefinanciering (DUO)", type: "income" },
  { slug: "care-allowance", name: "Zorgtoeslag", type: "income" },
  { slug: "rent-allowance", name: "Huurtoeslag", type: "income" },
  { slug: "family-gift", name: "Familie / gift", type: "income" },
  { slug: "other-income", name: "Overig inkomen", type: "income" },
  { slug: "internal-transfer", name: INTERNAL_TRANSFER_CATEGORY, type: "transfer" },
  { slug: "savings", name: SAVINGS_CATEGORY, type: "savings" },
];

/**
 * Starter rules: case-insensitive substring match on counterparty + description.
 * Higher priority wins; on equal priority the longer pattern wins. All editable in the app.
 */
export const DEFAULT_RULES: { pattern: string; category: string; priority: number }[] = [
  // Revolut's savings pot: moves to and from it are savings, not income or spending.
  { pattern: "instant access savings", category: SAVINGS_CATEGORY, priority: 30 },
  { pattern: "albert heijn", category: "Boodschappen", priority: 10 },
  { pattern: "jumbo", category: "Boodschappen", priority: 10 },
  { pattern: "lidl", category: "Boodschappen", priority: 10 },
  { pattern: "aldi", category: "Boodschappen", priority: 10 },
  { pattern: "dirk van den broek", category: "Boodschappen", priority: 10 },
  { pattern: "ah to go", category: "Eten & drinken", priority: 20 },
  { pattern: "thuisbezorgd", category: "Eten & drinken", priority: 10 },
  { pattern: "uber eats", category: "Eten & drinken", priority: 20 },
  { pattern: "deliveroo", category: "Eten & drinken", priority: 10 },
  { pattern: "mcdonald", category: "Eten & drinken", priority: 10 },
  { pattern: "starbucks", category: "Eten & drinken", priority: 10 },
  { pattern: "ns reizigers", category: "Vervoer", priority: 10 },
  { pattern: "ov-chipkaart", category: "Vervoer", priority: 10 },
  { pattern: "gvb", category: "Vervoer", priority: 10 },
  { pattern: "uber", category: "Vervoer", priority: 5 },
  { pattern: "spotify", category: "Abonnementen", priority: 10 },
  { pattern: "netflix", category: "Abonnementen", priority: 10 },
  { pattern: "disney", category: "Abonnementen", priority: 10 },
  { pattern: "anthropic", category: "Abonnementen", priority: 10 },
  { pattern: "claude.ai", category: "Abonnementen", priority: 10 },
  { pattern: "openai", category: "Abonnementen", priority: 10 },
  { pattern: "icloud", category: "Abonnementen", priority: 10 },
  { pattern: "ziggo", category: "Internet & telefoon", priority: 10 },
  { pattern: "kpn", category: "Internet & telefoon", priority: 10 },
  { pattern: "odido", category: "Internet & telefoon", priority: 10 },
  { pattern: "simyo", category: "Internet & telefoon", priority: 10 },
  { pattern: "vattenfall", category: "Gas, water, licht", priority: 10 },
  { pattern: "eneco", category: "Gas, water, licht", priority: 10 },
  { pattern: "essent", category: "Gas, water, licht", priority: 10 },
  { pattern: "greenchoice", category: "Gas, water, licht", priority: 10 },
  { pattern: "vitens", category: "Gas, water, licht", priority: 10 },
  { pattern: "zilveren kruis", category: "Zorgverzekering", priority: 10 },
  { pattern: "cz groep", category: "Zorgverzekering", priority: 10 },
  { pattern: "vgz", category: "Zorgverzekering", priority: 10 },
  { pattern: "menzis", category: "Zorgverzekering", priority: 10 },
  { pattern: "basic-fit", category: "Sport", priority: 10 },
  { pattern: "basic fit", category: "Sport", priority: 10 },
  { pattern: "sportcity", category: "Sport", priority: 10 },
  { pattern: "apotheek", category: "Gezondheid", priority: 10 },
  { pattern: "huisarts", category: "Gezondheid", priority: 10 },
  { pattern: "zalando", category: "Kleding & verzorging", priority: 10 },
  { pattern: "kruidvat", category: "Kleding & verzorging", priority: 10 },
  { pattern: "etos", category: "Kleding & verzorging", priority: 10 },
  { pattern: "booking.com", category: "Reizen & vakantie", priority: 10 },
  { pattern: "airbnb", category: "Reizen & vakantie", priority: 10 },
  { pattern: "klm", category: "Reizen & vakantie", priority: 10 },
  { pattern: "ryanair", category: "Reizen & vakantie", priority: 10 },
  { pattern: "degiro", category: "Sparen & beleggen", priority: 10 },
  { pattern: "collegegeld", category: "Studie", priority: 30 },
  { pattern: "dienst uitvoering onderwijs", category: "Studiefinanciering (DUO)", priority: 10 },
  { pattern: "studiefinanciering", category: "Studiefinanciering (DUO)", priority: 10 },
  { pattern: "huurtoeslag", category: "Huurtoeslag", priority: 30 },
  { pattern: "zorgtoeslag", category: "Zorgtoeslag", priority: 30 },
  { pattern: "salaris", category: "Salaris / bijbaan", priority: 10 },
  { pattern: "huur", category: "Huur", priority: 5 },
];
