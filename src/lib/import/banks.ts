import type { Bank } from "./types";

/** The banks the app reads, as a person writes them. */
export const BANK_NAMES: Record<Bank, string> = {
  rabobank: "Rabobank",
  revolut: "Revolut",
  abnamro: "ABN AMRO",
  ing: "ING",
  knab: "Knab",
};

export const bankName = (bank: string): string => BANK_NAMES[bank as Bank] ?? bank;
