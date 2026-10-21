import { schema, type Db } from "@/db";
import type { SMART_PROVIDERS } from "@/db/schema";
import type { CategoriserProvider } from "./provider";

export type SmartProviderId = (typeof SMART_PROVIDERS)[number];

/**
 * Version of the consent text the person agrees to when they switch the language model on. When the
 * text changes (what is sent, to whom), bump this: everyone is asked again and nothing is sent until
 * they agree.
 */
export const CONSENT_VERSION = 1;

export interface SmartSettings {
  provider: SmartProviderId;
  consentVersion: number | null;
}

/** Paying customers (for now: a list of user ids in KASBOEK_AI_USERS, comma separated). No billing yet. */
export function isEntitled(userId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.KASBOEK_AI_USERS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(userId.toLowerCase());
}

export async function getSmartSettings(db: Db): Promise<SmartSettings> {
  const [row] = await db.select().from(schema.userSettings);
  return { provider: row?.smartProvider ?? "off", consentVersion: row?.consentVersion ?? null };
}

export class SettingsError extends Error {}

/**
 * Choose where smart categorising gets its model from. "off" is always allowed. "claude" needs the
 * person's consent to the current text and the right to use it; "chatgpt" is not available yet.
 */
export async function setSmartProvider(
  db: Db,
  provider: SmartProviderId,
  opts: { consent: boolean; entitled: boolean },
): Promise<void> {
  if (provider === "chatgpt") throw new SettingsError("This option is not available yet.");
  if (provider === "claude") {
    if (!opts.entitled) throw new SettingsError("arnaq AI is part of arnaq plus.");
    if (!opts.consent) throw new SettingsError("Agree to what is sent before switching this on.");
  }
  const values =
    provider === "claude"
      ? {
          smartProvider: provider,
          consentVersion: CONSENT_VERSION,
          consentAt: new Date().toISOString(),
        }
      : { smartProvider: provider };
  await db
    .insert(schema.userSettings)
    .values(values)
    .onConflictDoUpdate({ target: schema.userSettings.userId, set: values });
}

/** Turn the person's settings into something that can be called, or null when it must not be used. */
export function resolveProvider(
  settings: SmartSettings,
  entitled: boolean,
  registry: Partial<Record<SmartProviderId, () => CategoriserProvider>>,
): CategoriserProvider | null {
  if (settings.provider === "off" || !entitled) return null;
  if (settings.consentVersion !== CONSENT_VERSION) return null;
  return registry[settings.provider]?.() ?? null;
}
