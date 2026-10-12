import type { Locale } from "../config";
import { auth as authEn } from "./en/auth";
import { view as viewEn } from "./en/view";
import { ui as uiEn } from "./en/ui";
import { auth as authNl } from "./nl/auth";
import { view as viewNl } from "./nl/view";
import { ui as uiNl } from "./nl/ui";

/** English is the source of truth; Dutch must have exactly the same shape (the compiler checks). */
const en = { view: viewEn, ui: uiEn, auth: authEn };
const nl: typeof en = { view: viewNl, ui: uiNl, auth: authNl };

export type Messages = typeof en;
export const messages: Record<Locale, Messages> = { en, nl };
