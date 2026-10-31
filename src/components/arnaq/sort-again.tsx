"use client";

import { useI18n } from "@/i18n/client";
import { api } from "@/lib/client/api";
import { useAction } from "./use-action";

/** Ask arnaq to sort the open transactions again with what it knows now, without uploading anything. */
export function SortAgain() {
  const { t } = useI18n();
  const { run, pending } = useAction();
  const toast = t.ui.upload.toast;
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        run(() => api("POST", "/api/categorise/auto"), {
          success: (data) => {
            const sorted = (data as { sorted?: number } | null)?.sorted ?? 0;
            return sorted > 0 ? toast.sortedAgain(sorted) : toast.nothingMore;
          },
        })
      }
      className="text-accent font-semibold disabled:opacity-50"
    >
      {t.ui.upload.sortAgain}
    </button>
  );
}
