"use client";

import { FileUp } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useI18n } from "@/i18n/client";
import { BANK_NAMES } from "@/lib/import/banks";
import { formatter } from "@/lib/view/format";
import { ErrorLine, Field, PrimaryButton, inputClass } from "./form";
import { ChaseSpinner, DoneRing } from "./motion";

interface Summary {
  bank: string;
  month: string;
  period: { from: string; to: string } | null;
  skipped: { line: number; reason: string }[];
  rowsImported: number;
  rowsDuplicate: number;
  rowsSkipped: number;
  foreignCurrencyRows: number;
  warnings: string[];
  recurring: { matched: number; occurrencesCreated: number; missed: number };
  sortedNow: number;
  openAfter: number;
  latest: string | null;
  savingsCheck: {
    expected: number;
    actual: number;
    difference: number;
    from: string;
    asOf: string;
    status: "match" | "interest" | "off";
  } | null;
}

const BANK = BANK_NAMES as Record<string, string>;

/** Pick or drop one bank statement. The bank and month are detected; both can be set under "Options". */
export function UploadPanel({ accounts }: { accounts: { id: number; name: string }[] }) {
  const router = useRouter();
  const { locale, t } = useI18n();
  const p = t.ui.upload.panel;
  const { dayLabel, monthName, euroExact } = formatter(locale);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [, startTransition] = useTransition();
  const done = useRef<HTMLDivElement>(null);

  // The result is the point of the upload: bring it into view so "did it work?" is answered at once.
  useEffect(() => {
    if (!summary) return;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    done.current?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
  }, [summary]);

  function choose(f: File | undefined | null) {
    if (busy) return; // a file picked mid-upload would clear the result that is about to arrive
    setError(null);
    setSummary(null);
    if (!f) return setFile(null);
    if (!/\.(csv|pdf)$/i.test(f.name)) return setError(p.errType);
    if (f.size > 4 * 1024 * 1024) return setError(p.errSize);
    setFile(f);
  }

  async function submit(form: FormData) {
    if (!file) return setError(p.errNone);
    setBusy(true);
    setError(null);
    const body = new FormData();
    body.set("file", file);
    const account = String(form.get("accountId") ?? "");
    const month = String(form.get("month") ?? "");
    if (account) body.set("accountId", account);
    if (month) body.set("month", month);
    try {
      const res = await fetch("/api/import", { method: "POST", body });
      const data = await res.json().catch(() => null);
      if (!res.ok)
        setError(res.status === 413 ? p.errSize : (data?.error ?? p.errFailed(res.status)));
      else {
        setSummary(data as Summary);
        setFile(null);
        if (input.current) input.current.value = "";
        startTransition(() => router.refresh());
      }
    } catch {
      setError(t.ui.common.noConnection);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(new FormData(e.currentTarget));
      }}
      className="grid gap-4"
    >
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          choose(e.dataTransfer.files[0]);
        }}
        className={`glass grid justify-items-center gap-2 border-2 border-dashed px-4 py-8 text-center ${drag ? "border-accent" : ""}`}
      >
        <span className="bg-soft text-accent grid size-12 place-items-center rounded-2xl">
          <FileUp className="size-6" />
        </span>
        <p className="text-[17px] font-semibold">{file ? file.name : p.pick}</p>
        <p className="text-ink-muted max-w-[40ch] text-sm">
          {file ? p.ready(Math.max(1, Math.round(file.size / 1024))) : p.hint}
        </p>
        <input
          ref={input}
          type="file"
          accept=".csv,.txt,.pdf,text/csv,text/plain,application/pdf"
          className="peer sr-only"
          id="csv"
          disabled={busy}
          onChange={(e) => choose(e.target.files?.[0])}
        />
        <label
          htmlFor="csv"
          className="bg-soft text-accent peer-focus-visible:outline-accent mt-1 inline-flex min-h-11 cursor-pointer items-center rounded-full px-5 text-[15px] font-semibold peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2"
        >
          {file ? p.other : p.choose}
        </label>
      </div>

      <details className="glass px-4 py-3">
        <summary className="min-h-6 cursor-pointer text-[15px] font-semibold">{p.options}</summary>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={p.account} hint={p.accountHint}>
            <select name="accountId" className={inputClass} defaultValue="">
              <option value="">{p.automatic}</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={p.month} hint={p.monthHint}>
            <input name="month" type="month" className={inputClass} />
          </Field>
        </div>
      </details>

      <ErrorLine message={error} />
      <div>
        <PrimaryButton type="submit" disabled={busy || !file}>
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <ChaseSpinner />
              {p.busy}
            </span>
          ) : (
            p.submit
          )}
        </PrimaryButton>
      </div>

      {summary && (
        <div
          ref={done}
          role="status"
          className="glass fade-in grid justify-items-center gap-3 p-5 text-center"
        >
          <DoneRing className="size-20" />
          <h3 className="font-display text-[26px] leading-tight font-medium">
            {summary.rowsImported > 0 ? p.doneTitle : p.upToDateTitle}
          </h3>
          <p className="text-ink-muted text-sm">
            {BANK[summary.bank] ?? summary.bank} ·{" "}
            {summary.period
              ? t.ui.upload.period(dayLabel(summary.period.from), dayLabel(summary.period.to))
              : monthName(summary.month)}
          </p>
          {summary.rowsImported > 0 ? (
            <>
              <dl className="num grid w-full grid-cols-3 gap-2 text-center">
                {[
                  [p.statNew, summary.rowsImported],
                  [p.statKnown, summary.rowsDuplicate],
                  [p.statSkipped, summary.rowsSkipped],
                ].map(([k, v]) => (
                  <div key={k} className="bg-soft rounded-2xl px-2 py-3">
                    <dt className="text-ink-muted text-[13px]">{k}</dt>
                    <dd className="text-2xl font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-ink-muted text-sm">
                {p.sortedLine(summary.sortedNow, summary.openAfter)}
              </p>
            </>
          ) : (
            <>
              <p className="text-ink-muted max-w-[40ch] text-sm">
                {p.nothingNew(summary.rowsDuplicate)}
              </p>
              {summary.latest && (
                <p className="bg-soft max-w-[40ch] rounded-2xl px-3 py-2.5 text-sm">
                  {p.latestNote(dayLabel(summary.latest))}
                </p>
              )}
            </>
          )}
          {summary.savingsCheck && (
            <p
              className={`max-w-[44ch] rounded-2xl px-3 py-2.5 text-left text-sm ${
                summary.savingsCheck.status === "off" ? "bg-soft text-warn font-medium" : "bg-soft"
              }`}
            >
              {p.savingsCheck[summary.savingsCheck.status](
                euroExact(summary.savingsCheck.actual),
                euroExact(summary.savingsCheck.expected),
                euroExact(Math.abs(summary.savingsCheck.difference)),
                dayLabel(summary.savingsCheck.asOf),
              )}
            </p>
          )}
          {summary.recurring.matched > 0 && (
            <p className="text-ink-muted text-sm">{p.matched(summary.recurring.matched)}</p>
          )}
          {summary.skipped.length > 0 && (
            <ul className="text-ink-muted list-disc pl-5 text-left text-sm">
              {summary.skipped.slice(0, 5).map((r) => (
                <li key={r.line}>{p.skippedLine(r.line, r.reason)}</li>
              ))}
              {summary.skipped.length > 5 && <li>{p.skippedMore(summary.skipped.length - 5)}</li>}
            </ul>
          )}
          {summary.warnings.map((w) => (
            <p key={w} className="text-warn text-sm font-medium">
              {w}
            </p>
          ))}
          <div className="grid w-full gap-2 pt-1">
            {summary.openAfter > 0 && (
              <a
                href="#sort"
                className="bg-action text-action-ink inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold"
              >
                {p.sortCta(summary.openAfter)}
              </a>
            )}
            <Link
              href="/"
              className={`inline-flex min-h-11 items-center justify-center rounded-full px-5 text-[15px] font-semibold ${
                summary.openAfter > 0 ? "liquid" : "bg-action text-action-ink"
              }`}
            >
              {p.seeToday}
            </Link>
          </div>
        </div>
      )}
    </form>
  );
}
