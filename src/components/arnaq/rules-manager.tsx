"use client";

import { useState } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { categoryLabel } from "@/lib/view/categories";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, Field, GhostButton, PrimaryButton, inputClass } from "./form";
import { useAction } from "./use-action";

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
  const { locale, t } = useI18n();
  const r18 = t.ui.settings.rule;
  const { run, pending: busy, error: apiError } = useAction();
  const [formError, setFormError] = useState<string | null>(null);
  const error = formError ?? apiError;

  function remove(id: number) {
    setFormError(null);
    return run(() => api("DELETE", `/api/rules/${id}`), { success: r18.removed });
  }

  /** True when the rule was added, so the form is only cleared then (a failure keeps what was typed). */
  async function add(form: FormData): Promise<boolean> {
    setFormError(null);
    const pattern = String(form.get("pattern") ?? "").trim();
    const categoryId = Number(form.get("categoryId"));
    if (pattern.length < 2) return (setFormError(r18.errPattern), false);
    if (!categoryId) return (setFormError(r18.errCategory), false);
    return run(
      () => api<{ alsoCategorised: number }>("POST", "/api/rules", { pattern, categoryId }),
      {
        success: (data) => {
          const n = (data as { alsoCategorised?: number } | null)?.alsoCategorised ?? 0;
          return n > 0 ? r18.addedSorted(n) : r18.added;
        },
      },
    );
  }

  return (
    <div className="grid gap-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const f = e.currentTarget;
          void add(new FormData(f)).then((added) => added && f.reset());
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
