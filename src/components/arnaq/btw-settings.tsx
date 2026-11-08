"use client";

import { useId, useState } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import type { BtwClient } from "@/lib/btw/clients";
import {
  BTW_PAYMENT_LAGS,
  DEFAULT_BTW_POCKET_MATCH,
  MAX_BTW_CLIENTS,
  isBtwPaymentLag,
  type BtwPaymentLag,
} from "@/lib/btw/defaults";
import { BTW_VAT_PERCENTS, isBtwVatPercent, type BtwVatPercent } from "@/lib/btw/rate";
import { ErrorLine, Field, GhostButton, PrimaryButton, inputClass } from "./form";
import { SlideOrButton } from "./slide-to-confirm";
import { useAction } from "./use-action";

/**
 * The person's BTW clients: who pays the invoices the BTW is set aside for, how long after the invoice each pays, and
 * at what rate. Add, edit and remove; removing asks first (a slide on a touch screen, a second button elsewhere).
 */
export function BtwClients({ clients }: { clients: BtwClient[] }) {
  const { t } = useI18n();
  const s = t.ui.btw.settings;
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<number | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);
  const { run, pending, error } = useAction();

  async function remove(id: number) {
    if (await run(() => api("DELETE", `/api/btw/clients/${id}`), { success: s.clientRemoved }))
      setConfirming(null);
  }

  return (
    <div className="glass grid gap-4 p-4">
      <p className="text-ink-muted max-w-[56ch] text-[15px]">{s.clientsIntro}</p>
      {clients.length === 0 ? (
        <p className="text-ink-muted text-[15px]">{s.noClients}</p>
      ) : (
        <ul className="divide-hair -mx-4 divide-y">
          {clients.map((c) => (
            <li key={c.id} className="grid gap-3 px-4 py-3">
              {editing === c.id ? (
                <ClientForm client={c} onDone={() => setEditing(null)} />
              ) : (
                <>
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{c.name}</p>
                    <p className="text-ink-muted text-[14px]">{s.lagSummary(c.paymentLag)}</p>
                    <p className="text-ink-muted text-[14px]">{s.rateSummary(c.vatPercent)}</p>
                  </div>
                  {confirming === c.id ? (
                    <div className="grid gap-2">
                      <p className="text-[15px]">{s.removeQuestion(c.name)}</p>
                      <div className="flex flex-wrap gap-2">
                        <SlideOrButton
                          label={t.ui.common.slide.remove}
                          disabled={pending}
                          onConfirm={() => void remove(c.id)}
                        >
                          <PrimaryButton
                            type="button"
                            disabled={pending}
                            onClick={() => void remove(c.id)}
                          >
                            {s.confirmRemoveClient}
                          </PrimaryButton>
                        </SlideOrButton>
                        <GhostButton type="button" onClick={() => setConfirming(null)}>
                          {t.ui.common.cancel}
                        </GhostButton>
                      </div>
                      <ErrorLine message={error} />
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <GhostButton
                        type="button"
                        disabled={pending}
                        aria-label={s.editClientLabel(c.name)}
                        onClick={() => {
                          setConfirming(null);
                          setAdding(false);
                          setEditing(c.id);
                        }}
                      >
                        {s.editClient}
                      </GhostButton>
                      <GhostButton
                        type="button"
                        disabled={pending}
                        aria-label={s.removeClientLabel(c.name)}
                        onClick={() => {
                          setEditing(null);
                          setConfirming(c.id);
                        }}
                      >
                        {s.removeClient}
                      </GhostButton>
                    </div>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="border-hair grid gap-3 border-t pt-4">
          <ClientForm onDone={() => setAdding(false)} />
        </div>
      ) : clients.length >= MAX_BTW_CLIENTS ? (
        <p className="text-ink-muted text-[14px]">{s.clientLimit(MAX_BTW_CLIENTS)}</p>
      ) : (
        <div>
          <GhostButton
            type="button"
            onClick={() => {
              setEditing(null);
              setConfirming(null);
              setAdding(true);
            }}
          >
            {s.addClient}
          </GhostButton>
        </div>
      )}
    </div>
  );
}

/** Add a client (no `client`) or edit one: the name on the statement, when they pay, and the rate. */
function ClientForm({ client, onDone }: { client?: BtwClient; onDone: () => void }) {
  const { t } = useI18n();
  const s = t.ui.btw.settings;
  const [name, setName] = useState(client?.name ?? "");
  const [lag, setLag] = useState<BtwPaymentLag>(client?.paymentLag ?? 0);
  const [rate, setRate] = useState<BtwVatPercent>(client?.vatPercent ?? 21);
  const { run, pending, error } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const body = { name, paymentLag: lag, vatPercent: rate };
    const saved = await run(
      () =>
        client
          ? api("PATCH", `/api/btw/clients/${client.id}`, body)
          : api("POST", "/api/btw/clients", body),
      { success: client ? s.clientSaved : s.clientAdded },
    );
    if (saved) onDone();
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <Field label={s.nameLabel} hint={s.nameHint}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={60}
          required
          autoComplete="off"
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
              could never count on a card in time (the data layer still accepts it, and a client that has it keeps it). */}
          {BTW_PAYMENT_LAGS.filter((l) => l <= 1 || l === lag).map((l) => (
            <option key={l} value={l}>
              {s.lagOption(l)}
            </option>
          ))}
        </select>
      </Field>
      <Field label={s.rateLabel} hint={s.rateHint(rate)}>
        <select
          value={rate}
          onChange={(e) => {
            const next = Number(e.target.value);
            if (isBtwVatPercent(next)) setRate(next);
          }}
          className={inputClass}
        >
          {BTW_VAT_PERCENTS.map((r) => (
            <option key={r} value={r}>
              {s.rateOption(r)}
            </option>
          ))}
        </select>
      </Field>
      <ErrorLine message={error} />
      <div className="flex flex-wrap gap-2">
        <PrimaryButton type="submit" disabled={pending}>
          {s.saveClient}
        </PrimaryButton>
        <GhostButton type="button" onClick={onDone}>
          {t.ui.common.cancel}
        </GhostButton>
      </div>
    </form>
  );
}

/**
 * The word that marks a move to savings as BTW money, and whether the BTW pot is part of the savings account. Who the
 * clients are is BtwClients.
 */
export function BtwSettings({ pocket, potInSavings }: { pocket: string; potInSavings: boolean }) {
  const { t } = useI18n();
  const s = t.ui.btw.settings;
  const [pocketText, setPocketText] = useState(pocket);
  const [pot, setPot] = useState(potInSavings);
  const potHint = useId();
  const { run, pending, error } = useAction();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(() => api("PUT", "/api/btw/settings", { pocket: pocketText, potInSavings: pot }), {
      success: s.saved,
    });
  }

  return (
    <form onSubmit={submit} className="glass grid gap-4 p-4">
      <p className="text-ink-muted max-w-[56ch] text-[15px]">{s.intro}</p>
      <Field label={s.pocketLabel} hint={s.pocketHint}>
        <input
          value={pocketText}
          onChange={(e) => setPocketText(e.target.value)}
          placeholder={DEFAULT_BTW_POCKET_MATCH}
          maxLength={60}
          className={inputClass}
        />
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
