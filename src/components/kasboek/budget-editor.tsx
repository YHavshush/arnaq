"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { api, euroInputToCents } from "@/lib/client/api";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, GhostButton, inputClass } from "./form";

interface Line {
  categoryId: number;
  name: string;
  /** Cents, or null when no budget is set. */
  budget: number | null;
}

const toInput = (cents: number | null) =>
  cents === null ? "" : (cents / 100).toFixed(2).replace(".", ",");

/**
 * One input per category plus an optional total. A field saves when you leave it; an empty field
 * removes that budget. "Kopieer vorige maand" fills the month from the one before.
 */
export function BudgetEditor({
  month,
  prevMonth,
  lines,
  total,
  prevLabel,
}: {
  month: string;
  prevMonth: string;
  lines: Line[];
  total: number | null;
  prevLabel: string;
}) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedKey, setSavedKey] = useState<string | null>(null);

  async function save(
    key: string,
    raw: string,
    before: number | null,
    call: (cents: number | null) => ReturnType<typeof api>,
  ) {
    const trimmed = raw.trim();
    const cents = trimmed === "" ? null : euroInputToCents(trimmed);
    if (trimmed !== "" && cents === null)
      return setError("Vul een bedrag in, bijvoorbeeld 250 of 12,50.");
    if (cents === before) return;
    setError(null);
    const res = await call(cents);
    if (!res.ok) return setError(res.error);
    setSavedKey(key);
    startTransition(() => router.refresh());
  }

  async function copy() {
    setError(null);
    const res = await api("POST", "/api/budgets/copy", { from: prevMonth, to: month });
    if (!res.ok) return setError(res.error);
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-4">
      <div className="glass grid gap-3 p-4">
        <label className="grid gap-1.5 text-sm font-medium">
          Totaal budget voor de maand
          <input
            inputMode="decimal"
            defaultValue={toInput(total)}
            key={`total-${total}`}
            placeholder="Leeg: som van de categorieën"
            className={inputClass}
            onBlur={(e) =>
              save("total", e.target.value, total, (amount) =>
                api("PUT", "/api/budgets/total", { month, amount }),
              )
            }
          />
        </label>
        <div>
          <GhostButton type="button" disabled={busy} onClick={copy}>
            Kopieer {prevLabel}
          </GhostButton>
        </div>
      </div>

      <div className="glass overflow-hidden">
        <ul className="divide-hair divide-y">
          {lines.map((l) => (
            <li
              key={l.categoryId}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_7.5rem] items-center gap-3 px-4 py-2.5"
            >
              <CategoryIcon name={l.name} />
              <label htmlFor={`b-${l.categoryId}`} className="min-w-0 truncate font-semibold">
                {l.name}
                {savedKey === `c${l.categoryId}` && (
                  <span className="text-good ml-2 text-[13px] font-medium">bewaard</span>
                )}
              </label>
              <input
                id={`b-${l.categoryId}`}
                inputMode="decimal"
                defaultValue={toInput(l.budget)}
                key={`${l.categoryId}-${l.budget}`}
                placeholder="€"
                aria-label={`Budget voor ${l.name} in euro`}
                className={`${inputClass} num text-right`}
                onBlur={(e) =>
                  save(`c${l.categoryId}`, e.target.value, l.budget, (amount) =>
                    api("PUT", "/api/budgets", { month, categoryId: l.categoryId, amount }),
                  )
                }
              />
            </li>
          ))}
        </ul>
      </div>
      <ErrorLine message={error} />
    </div>
  );
}
