import type { Locale } from "../config";
import { view as viewEn } from "./en/view";
import { ui as uiEn } from "./en/ui";
import { view as viewNl } from "./nl/view";
import { ui as uiNl } from "./nl/ui";

/** English is the source of truth; Dutch must have exactly the same shape (the compiler checks). */
const en = { view: viewEn, ui: uiEn };
const nl: typeof en = { view: viewNl, ui: uiNl };

export type Messages = typeof en;
export const messages: Record<Locale, Messages> = { en, nl };
