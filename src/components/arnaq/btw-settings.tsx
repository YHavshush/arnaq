"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { DEFAULT_BTW_INCOME_MATCH, DEFAULT_BTW_POCKET_MATCH } from "@/lib/btw/defaults";
import { ErrorLine, Field, PrimaryButton, inputClass } from "./form";
import { useAction } from "./use-action";

/** Who pays the invoices the BTW is set aside for, and the word that marks a move to savings as BTW money. */
export function BtwSettings({ client, pocket }: { client: string; pocket: string }) {
  const { t } = useI18n();
  const s = t.ui.btw.settings;
  const [clientText, setClientText] = useState(client);
  const [pocketText, setPocketText] = useState(pocket);
  const { run, pending, error } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(() => api("PUT", "/api/btw/settings", { client: clientText, pocket: pocketText }), {
      success: s.saved,
    });
  }

  return (
    <form onSubmit={submit} className="glass grid gap-4 p-4">
      <p className="text-ink-muted max-w-[56ch] text-[15px]">{s.intro}</p>
      <Field label={s.clientLabel} hint={s.clientHint}>
        <input
          value={clientText}
          onChange={(e) => setClientText(e.target.value)}
          placeholder={DEFAULT_BTW_INCOME_MATCH}
          maxLength={60}
          className={inputClass}
        />
      </Field>
      <Field label={s.pocketLabel} hint={s.pocketHint}>
        <input
          value={pocketText}
          onChange={(e) => setPocketText(e.target.value)}
          placeholder={DEFAULT_BTW_POCKET_MATCH}
          maxLength={60}
          className={inputClass}
        />
      </Field>
      <ErrorLine message={error} />
      <div>
        <PrimaryButton type="submit" disabled={pending}>
          {s.save}
        </PrimaryButton>
      </div>
    </form>
  );
}
