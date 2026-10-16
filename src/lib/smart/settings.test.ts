import { describe, expect, it } from "vitest";
import { createDb } from "@/db";
import { FakeProvider } from "./providers/fake";
import {
  CONSENT_VERSION,
  SettingsError,
  getSmartSettings,
  isEntitled,
  resolveProvider,
  setSmartProvider,
} from "./settings";

const USER = "11111111-1111-1111-1111-111111111111";

describe("isEntitled", () => {
  it("is on only for the listed users, whatever the case or spacing", () => {
    expect(isEntitled(USER, { KASBOEK_AI_USERS: ` ${USER.toUpperCase()} , other ` } as never)).toBe(
      true,
    );
    expect(isEntitled(USER, { KASBOEK_AI_USERS: "someone-else" } as never)).toBe(false);
    expect(isEntitled(USER, {} as never)).toBe(false);
    expect(isEntitled(USER, { KASBOEK_AI_USERS: "" } as never)).toBe(false);
  });
});

describe("smart settings", () => {
  it("default to off; claude needs consent and the right to use it; chatgpt is not available", async () => {
    const db = await createDb(":memory:");
    expect(await getSmartSettings(db)).toEqual({ provider: "off", consentVersion: null });
    await expect(
      setSmartProvider(db, "claude", { consent: false, entitled: true }),
    ).rejects.toBeInstanceOf(SettingsError);
    await expect(
      setSmartProvider(db, "claude", { consent: true, entitled: false }),
    ).rejects.toBeInstanceOf(SettingsError);
    await expect(
      setSmartProvider(db, "chatgpt", { consent: true, entitled: true }),
    ).rejects.toBeInstanceOf(SettingsError);
    expect(await getSmartSettings(db)).toEqual({ provider: "off", consentVersion: null });

    await setSmartProvider(db, "claude", { consent: true, entitled: true });
    expect(await getSmartSettings(db)).toEqual({
      provider: "claude",
      consentVersion: CONSENT_VERSION,
    });
    await setSmartProvider(db, "off", { consent: false, entitled: false });
    expect((await getSmartSettings(db)).provider).toBe("off");
  });
});

describe("resolveProvider", () => {
  const registry = { claude: () => new FakeProvider() };
  const on = { provider: "claude" as const, consentVersion: CONSENT_VERSION };
  it("gives a provider only when it is on, consented to the current text, entitled and available", () => {
    expect(resolveProvider(on, true, registry)).not.toBeNull();
    expect(
      resolveProvider({ provider: "off", consentVersion: CONSENT_VERSION }, true, registry),
    ).toBeNull();
    expect(resolveProvider(on, false, registry)).toBeNull();
    expect(
      resolveProvider({ ...on, consentVersion: CONSENT_VERSION - 1 }, true, registry),
    ).toBeNull();
    expect(resolveProvider({ ...on, consentVersion: null }, true, registry)).toBeNull();
    expect(resolveProvider(on, true, {})).toBeNull(); // nothing built for it: nothing is sent
  });
});
