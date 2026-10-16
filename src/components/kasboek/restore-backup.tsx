"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { ErrorLine, GhostButton } from "./form";

const MAX_BYTES = 25 * 1024 * 1024;

/** Put a backup file back: it replaces what is there. Asks for a tick first. */
export function RestoreBackup() {
  const router = useRouter();
  const { t } = useI18n();
  const s = t.ui.settings.restore;
  const [busy, startTransition] = useTransition();
  const [file, setFile] = useState<File | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function restore() {
    if (!file) return;
    setError(null);
    setDone(false);
    if (file.size > MAX_BYTES) return setError(s.notBackup);
    let backup: unknown;
    try {
      backup = JSON.parse(await file.text());
    } catch {
      return setError(s.notBackup);
    }
    setWorking(true);
    const res = await api("POST", "/api/account/restore", backup);
    setWorking(false);
    if (!res.ok) return setError(res.error);
    setDone(true);
    setFile(null);
    setAgreed(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="glass grid gap-3 p-4">
      <p className="max-w-[56ch] text-[15px]">{s.body}</p>
      <label className="grid gap-1 text-[15px] font-semibold">
        {s.choose}
        <input
          type="file"
          accept="application/json,.json"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="text-[15px] font-normal"
        />
      </label>
      <label className="flex min-h-11 items-center gap-3 text-[15px]">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => setAgreed(e.target.checked)}
          className="size-5"
        />
        {s.agree}
      </label>
      <div>
        <GhostButton type="button" disabled={!file || !agreed || working || busy} onClick={restore}>
          {working ? s.working : s.button}
        </GhostButton>
      </div>
      <div aria-live="polite">
        {error ? (
          <ErrorLine message={error} />
        ) : done ? (
          <span className="text-ink-muted text-[13px]">{s.done}</span>
        ) : null}
      </div>
    </div>
  );
}
