"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { api } from "@/lib/client/api";

const KEY = "arnaq:recurring-sync";

/**
 * Once each time the app is opened: let fixed items catch up with the transactions that are already in. Matching
 * normally happens on an upload, so a better matching rule (or an item added after the upload) would otherwise wait
 * for the next one. Refreshes the page only when something changed.
 */
export function RecurringSync() {
  const router = useRouter();
  useEffect(() => {
    try {
      if (sessionStorage.getItem(KEY)) return;
      sessionStorage.setItem(KEY, "1");
    } catch {
      return; // no storage: skip, nothing breaks
    }
    void api<{ matched: number; missed: number; occurrencesCreated: number }>(
      "POST",
      "/api/recurring/sync",
    ).then((res) => {
      if (
        res.ok &&
        (res.data.matched > 0 || res.data.missed > 0 || res.data.occurrencesCreated > 0)
      )
        router.refresh();
    });
  }, [router]);
  return null;
}
