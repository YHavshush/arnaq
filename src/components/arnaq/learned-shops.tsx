"use client";

import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { CategoryIcon } from "./category-icon";
import { ErrorLine, GhostButton } from "./form";
import { useAction } from "./use-action";

interface Shop {
  id: number;
  key: string;
  categoryName: string;
  categoryLabel: string;
  /** Which way the money moved, for a remembered transfer between the person's own accounts. */
  direction: "in" | "out" | null;
}

/** The shops arnaq has been taught: see them, forget one. */
export function LearnedShops({ shops }: { shops: Shop[] }) {
  const { t } = useI18n();
  const s = t.ui.settings.learned;
  const { run, pending: busy, error } = useAction();

  if (shops.length === 0) return <p className="text-ink-muted px-1 text-[15px]">{s.none}</p>;
  return (
    <div className="glass overflow-hidden">
      <ul className="divide-hair divide-y">
        {shops.map((shop) => (
          <li
            key={shop.id}
            className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3"
          >
            <CategoryIcon name={shop.categoryName} />
            <div className="min-w-0">
              <div className="truncate font-semibold">{shop.key}</div>
              <div className="text-ink-muted text-[13px]">
                {s.meta(shop.categoryLabel, shop.direction)}
              </div>
            </div>
            <GhostButton
              type="button"
              disabled={busy}
              aria-label={s.forgetFor(shop.key)}
              onClick={() =>
                run(() => api("DELETE", `/api/merchant-labels/${shop.id}`), {
                  success: s.forgotten,
                })
              }
            >
              {s.forget}
            </GhostButton>
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
