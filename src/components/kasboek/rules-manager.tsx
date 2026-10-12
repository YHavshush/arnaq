"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { categoryLabel } from "@/lib/view/categories";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, Field, GhostButton, PrimaryButton, inputClass } from "./form";

interface Rule {
  id: number;
  pattern: string;
  categoryName: string;
  priority: number;
}
interface Cat {
  id: number;
  name: string;
  type: string;
}

/** The rules that sort transactions: see them, remove one, add one. A rule matches a piece of text in the name or description. */
export function RulesManager({ rules, categories }: { rules: Rule[]; categories: Cat[] }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const r18 = t.ui.settings.rule;
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function remove(id: number) {
    setError(null);
    setNote(null);
    const res = await api("DELETE", `/api/rules/${id}`);
    if (!res.ok) return setError(res.error);
    startTransition(() => router.refresh());
  }

  async function add(form: FormData) {
    setError(null);
    setNote(null);
    const pattern = String(form.get("pattern") ?? "").trim();
    const categoryId = Number(form.get("categoryId"));
    if (pattern.length < 2) return setError(r18.errPattern);
    if (!categoryId) return setError(r18.errCategory);
    const res = await api<{ alsoCategorised: number }>("POST", "/api/rules", {
      pattern,
      categoryId,
    });
    if (!res.ok) return setError(res.error);
    setNote(res.data.alsoCategorised > 0 ? r18.addedSorted(res.data.alsoCategorised) : r18.added);
    startTransition(() => router.refresh());
  }

  return (
    <div className="grid gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          void add(new FormData(f)).then(() => f.reset());
        }}
        className="glass grid gap-3 p-4"
      >
        <Field label={r18.ifContains} hint={r18.ifHint}>
          <input name="pattern" maxLength={100} className={inputClass} />
        </Field>
        <Field label={r18.thenPut}>
          <select name="categoryId" className={inputClass} defaultValue="">
            <option value="">{r18.choose}</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {categoryLabel(c.name, locale)}
              </option>
            ))}
          </select>
        </Field>
        <ErrorLine message={error} />
        {note && (
          <p role="status" className="text-good text-sm font-medium">
            {note}
          </p>
        )}
        <div>
          <PrimaryButton type="submit" disabled={busy}>
            {r18.add}
          </PrimaryButton>
        </div>
      </form>

      <div className="glass overflow-hidden">
        <ul className="divide-hair divide-y">
          {rules.map((r) => (
            <li
              key={r.id}
              className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
            >
              <CategoryIcon name={r.categoryName} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{r.pattern}</div>
                <div className="text-ink-muted truncate text-[13px]">
                  {categoryLabel(r.categoryName, locale)}
                </div>
              </div>
              <GhostButton
                type="button"
                disabled={busy}
                onClick={() => remove(r.id)}
                aria-label={r18.removeRule(r.pattern)}
              >
                {r18.remove}
              </GhostButton>
            </li>
          ))}
        </ul>
        {rules.length === 0 && (
          <p className="text-ink-muted px-4 py-6 text-center text-[15px]">{r18.none}</p>
        )}
      </div>
    </div>
  );
}
