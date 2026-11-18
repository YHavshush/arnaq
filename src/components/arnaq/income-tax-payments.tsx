"use client";

import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import type { TaxOfficePayment } from "@/lib/income-tax/payments";
import { formatter } from "@/lib/view/format";
import { ErrorLine, GhostButton } from "./form";
import { useAction } from "./use-action";

/**
 * The payments to the tax office, to pick as income tax for `year` (or to take back). This is the one way a payment
 * becomes income tax (incomeTaxPaymentYear): until it is picked, a payment to the tax office counts as BTW.
 */
export function IncomeTaxPayments({
  year,
  payments,
}: {
  year: number;
  payments: TaxOfficePayment[];
}) {
  const { t, locale } = useI18n();
  const s = t.ui.incomeTax;
  const { euro, dayLabel } = formatter(locale);
  const { run, pending, error } = useAction();

  async function pick(id: number, to: number | null) {
    await run(() => api("PUT", `/api/income-tax/payments/${id}`, { year: to }), {
      success: to === null ? s.unpicked : s.picked,
    });
  }

  return (
    <details className="border-hair mt-3 border-t pt-3">
      <summary className="flex min-h-11 cursor-pointer items-center text-[15px] font-semibold">
        {s.paymentsTitle}
      </summary>
      <p className="text-ink-muted text-[14px]">{s.paymentsHint(year)}</p>
      {payments.length === 0 ? (
        <p className="text-ink-muted mt-2 text-[14px]">{s.noPayments}</p>
      ) : (
        <ul className="divide-hair mt-2 divide-y">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="num text-[15px]">
                {dayLabel(p.date)} · {euro(p.amount)}
              </span>
              {p.year === year ? (
                <GhostButton
                  type="button"
                  disabled={pending}
                  aria-label={s.unpickLabel(dayLabel(p.date), euro(p.amount))}
                  onClick={() => void pick(p.id, null)}
                >
                  {s.unpick}
                </GhostButton>
              ) : (
                <span className="flex flex-wrap items-center gap-2">
                  {p.year !== null && (
                    <span className="text-ink-muted text-[14px]">{s.pickedOther(p.year)}</span>
                  )}
                  <GhostButton
                    type="button"
                    disabled={pending}
                    aria-label={s.pickLabel(dayLabel(p.date), euro(p.amount), year)}
                    onClick={() => void pick(p.id, year)}
                  >
                    {s.pick(year)}
                  </GhostButton>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorLine message={error} />
    </details>
  );
}
