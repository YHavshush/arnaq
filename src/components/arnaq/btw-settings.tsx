"use client";

import { useId, useState } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import {
  BTW_PAYMENT_LAGS,
  DEFAULT_BTW_INCOME_MATCH,
  DEFAULT_BTW_POCKET_MATCH,
  isBtwPaymentLag,
  type BtwPaymentLag,
} from "@/lib/btw/defaults";
import { ErrorLine, Field, PrimaryButton, inputClass } from "./form";
import { useAction } from "./use-action";

/**
 * Who pays the invoices the BTW is set aside for, the word that marks a move to savings as BTW money, how long
 * after the invoice the client usually pays, and whether the BTW pot is part of the savings account.
 */
export function BtwSettings({
  client,
  pocket,
  paymentLag,
  potInSavings,
}: {
  client: string;
  pocket: string;
  paymentLag: BtwPaymentLag;
  potInSavings: boolean;
}) {
  const { t } = useI18n();
  const s = t.ui.btw.settings;
  const [clientText, setClientText] = useState(client);
  const [pocketText, setPocketText] = useState(pocket);
  const [lag, setLag] = useState<BtwPaymentLag>(paymentLag);
  const [pot, setPot] = useState(potInSavings);
  const potHint = useId();
  const { run, pending, error } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(
      () =>
        api("PUT", "/api/btw/settings", {
          client: clientText,
          pocket: pocketText,
          paymentLag: lag,
          potInSavings: pot,
        }),
      { success: s.saved },
    );
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
      <Field label={s.lagLabel} hint={s.lagHint(lag)}>
        <select
          value={lag}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (isBtwPaymentLag(next)) setLag(next);
          }}
          className={inputClass}
        >
          {/* Two months is not offered: the return is due a month after the quarter, so money arriving later than that
              could never count on a card in time (the data layer still accepts it). */}
          {BTW_PAYMENT_LAGS.filter((l) => l <= 1 || l === lag).map((l) => (
            <option key={l} value={l}>
              {s.lagOption(l)}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid gap-1.5">
        <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
          <input
            type="checkbox"
            checked={pot}
            onChange={(e) => setPot(e.target.checked)}
            aria-describedby={potHint}
            className="size-5"
          />
          {s.potLabel}
        </label>
        <span id={potHint} className="text-ink-muted text-[13px]">
          {s.potHint}
        </span>
      </div>
      <ErrorLine message={error} />
      <div>
        <PrimaryButton type="submit" disabled={pending}>
          {s.save}
        </PrimaryButton>
      </div>
    </form>
  );
}
