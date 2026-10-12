"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api, euroInputToCents } from "@/lib/client/api";
import { euro } from "@/lib/view/format";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, Field, GhostButton, PrimaryButton, inputClass } from "./form";

interface Cat {
  id: number;
  name: string;
  type: "expense" | "income" | "transfer";
}

interface SuggestionView {
  key: string;
  type: "expense" | "income";
  name: string;
  expectedAmount: number;
  dayOfMonth: number;
  categoryName: string | null;
  months: number;
}

/** Detected recurring payments: accept (becomes a vaste last) or reject (never offered again). */
export function SuggestionList({ suggestions }: { suggestions: SuggestionView[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function act(path: "accept" | "reject", s: SuggestionView) {
    setError(null);
    const res = await api("POST", `/api/recurring/suggestions/${path}`, {
      key: s.key,
      type: s.type,
    });
    if (!res.ok) return setError(res.error);
    startTransition(() => router.refresh());
  }

  return (
    <div className="glass overflow-hidden">
      <ul className="divide-hair divide-y">
        {suggestions.map((s) => (
          <li key={`${s.type}:${s.key}`} className="grid gap-3 px-4 py-3">
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3">
              <CategoryIcon name={s.categoryName} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{s.name}</div>
                <div className="text-ink-muted text-[13px]">
                  {s.months} maanden achter elkaar, rond de {s.dayOfMonth}e
                </div>
              </div>
              <div className="num font-semibold">{euro(s.expectedAmount)}</div>
            </div>
            <div className="flex gap-2">
              <PrimaryButton type="button" disabled={busy} onClick={() => act("accept", s)}>
                Toevoegen
              </PrimaryButton>
              <GhostButton type="button" disabled={busy} onClick={() => act("reject", s)}>
                Niet meer tonen
              </GhostButton>
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div className="px-4 pb-3">
          <ErrorLine message={error} />
        </div>
      )}
    </div>
  );
}

interface ItemView {
  id: number;
  name: string;
  type: "expense" | "income";
  expectedAmount: number;
  dayOfMonth: number;
  frequency: "monthly" | "quarterly" | "yearly";
  active: boolean;
  categoryName: string | null;
}

const FREQ = { monthly: "per maand", quarterly: "per kwartaal", yearly: "per jaar" } as const;

/** All vaste lasten with pause/resume and delete. Delete asks twice (it cannot be undone). */
export function ItemManager({ items }: { items: ItemView[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<number | null>(null);

  async function run(res: ReturnType<typeof api>) {
    setError(null);
    const r = await res;
    if (!r.ok) return setError(r.error);
    setConfirming(null);
    startTransition(() => router.refresh());
  }

  if (items.length === 0) return null;
  return (
    <div className="glass overflow-hidden">
      <ul className="divide-hair divide-y">
        {items.map((it) => (
          <li key={it.id} className="grid gap-2 px-4 py-3">
            <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3">
              <CategoryIcon name={it.categoryName} />
              <div className="min-w-0">
                <div className="truncate font-semibold">
                  {it.name}
                  {!it.active && (
                    <span className="text-ink-muted ml-2 text-[13px] font-medium">gepauzeerd</span>
                  )}
                </div>
                <div className="text-ink-muted text-[13px]">
                  dag {it.dayOfMonth}, {FREQ[it.frequency]}
                </div>
              </div>
              <div className="num font-semibold">{euro(it.expectedAmount)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <GhostButton
                type="button"
                disabled={busy}
                onClick={() => run(api("PATCH", `/api/recurring/${it.id}`, { active: !it.active }))}
              >
                {it.active ? "Pauzeren" : "Hervatten"}
              </GhostButton>
              {confirming === it.id ? (
                <>
                  <PrimaryButton
                    type="button"
                    disabled={busy}
                    onClick={() => run(api("DELETE", `/api/recurring/${it.id}`))}
                  >
                    Ja, verwijderen
                  </PrimaryButton>
                  <GhostButton type="button" onClick={() => setConfirming(null)}>
                    Annuleren
                  </GhostButton>
                </>
              ) : (
                <GhostButton type="button" disabled={busy} onClick={() => setConfirming(it.id)}>
                  Verwijderen
                </GhostButton>
              )}
            </div>
          </li>
        ))}
      </ul>
      {error && (
        <div className="px-4 pb-3">
          <ErrorLine message={error} />
        </div>
      )}
    </div>
  );
}

/** Add a vaste last by hand. */
export function AddItemForm({ categories, today }: { categories: Cat[]; today: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<"expense" | "income">("expense");
  const [error, setError] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  async function submit(form: FormData) {
    setError(null);
    const cents = euroInputToCents(String(form.get("amount") ?? ""));
    if (cents === null || cents === 0) return setError("Vul een bedrag in, bijvoorbeeld 12,50.");
    const name = String(form.get("name") ?? "").trim();
    if (!name) return setError("Geef de vaste last een naam.");
    const counterparty = String(form.get("counterparty") ?? "").trim();
    const categoryId = Number(form.get("categoryId"));
    const res = await api("POST", "/api/recurring", {
      name,
      type,
      expectedAmount: cents,
      dayOfMonth: Number(form.get("day")),
      frequency: String(form.get("frequency")),
      matchCounterparty: counterparty || name,
      categoryId: categoryId > 0 ? categoryId : null,
      startDate: String(form.get("start")),
      tolerance: Math.round(cents * 0.1),
    });
    if (!res.ok) return setError(res.error);
    setOpen(false);
    startTransition(() => router.refresh());
  }

  if (!open)
    return (
      <GhostButton type="button" onClick={() => setOpen(true)}>
        <span className="inline-flex items-center gap-1.5">
          <Plus className="size-4" /> Vaste last toevoegen
        </span>
      </GhostButton>
    );

  return (
    <form action={submit} className="glass fade-in grid gap-4 p-4">
      <div
        role="radiogroup"
        aria-label="Soort"
        className="bg-track inline-flex w-fit rounded-xl p-0.5"
      >
        {(["expense", "income"] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={type === t}
            onClick={() => setType(t)}
            className="text-ink-muted aria-checked:bg-surface aria-checked:text-ink min-h-10 rounded-[10px] px-4 text-sm font-semibold"
          >
            {t === "expense" ? "Uitgave" : "Inkomen"}
          </button>
        ))}
      </div>
      <Field label="Naam">
        <input
          name="name"
          required
          maxLength={100}
          className={inputClass}
          placeholder="Bijvoorbeeld Netflix"
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Bedrag (€)">
          <input
            name="amount"
            required
            inputMode="decimal"
            className={inputClass}
            placeholder="12,50"
          />
        </Field>
        <Field label="Dag van de maand">
          <input
            name="day"
            type="number"
            min={1}
            max={31}
            defaultValue={1}
            required
            className={inputClass}
          />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Hoe vaak">
          <select name="frequency" className={inputClass} defaultValue="monthly">
            <option value="monthly">Per maand</option>
            <option value="quarterly">Per kwartaal</option>
            <option value="yearly">Per jaar</option>
          </select>
        </Field>
        <Field label="Categorie">
          <select name="categoryId" className={inputClass} defaultValue="0">
            <option value="0">Geen</option>
            {categories
              .filter((c) => c.type === type)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
      </div>
      <Field
        label="Naam op je afschrift"
        hint="Waaraan we de betaling herkennen. Leeg laten gebruikt de naam hierboven."
      >
        <input name="counterparty" maxLength={100} className={inputClass} />
      </Field>
      <Field label="Vanaf">
        <input
          name="start"
          type="date"
          defaultValue={`${today.slice(0, 7)}-01`}
          required
          className={inputClass}
        />
      </Field>
      <ErrorLine message={error} />
      <div className="flex gap-2">
        <PrimaryButton type="submit" disabled={busy}>
          Opslaan
        </PrimaryButton>
        <GhostButton type="button" onClick={() => setOpen(false)}>
          Annuleren
        </GhostButton>
      </div>
    </form>
  );
}
