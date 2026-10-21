"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { ErrorLine, Field, GhostButton, inputClass } from "./form";

/** Deletes everything the person has stored; asks them to type a word first. */
export function EraseData() {
  const router = useRouter();
  const { t } = useI18n();
  const s = t.ui.settings.erase;
  const [busy, startTransition] = useTransition();
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function erase() {
    setError(null);
    const res = await api("POST", "/api/account/delete", { confirm: "delete" });
    if (!res.ok) return setError(res.error);
    setDone(true);
    setTyped("");
    startTransition(() => router.refresh());
  }

  return (
    <div className="glass grid gap-3 p-4">
      <p className="max-w-[56ch] text-[15px]">{s.body}</p>
      <Field label={s.prompt}>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          className={inputClass}
        />
      </Field>
      <div>
        <GhostButton
          type="button"
          disabled={busy || typed.trim().toLowerCase() !== s.word}
          onClick={erase}
        >
          {s.button}
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
