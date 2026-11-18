import type { Locale } from "../config";
import { auth as authEn } from "./en/auth";
import { legal as legalEn } from "./en/legal";
import { view as viewEn } from "./en/view";
import { ui as uiEn } from "./en/ui";
import { auth as authNl } from "./nl/auth";
import { legal as legalNl } from "./nl/legal";
import { view as viewNl } from "./nl/view";
import { ui as uiNl } from "./nl/ui";

/** English is the source of truth; Dutch must have exactly the same shape (the compiler checks). */
const en = { view: viewEn, ui: uiEn, auth: authEn, legal: legalEn };
const nl: typeof en = { view: viewNl, ui: uiNl, auth: authNl, legal: legalNl };

export type Messages = typeof en;
export const messages: Record<Locale, Messages> = { en, nl };
