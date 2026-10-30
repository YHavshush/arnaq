"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState, useTransition } from "react";
import type { ApiResult } from "@/lib/client/api";
import { useToast } from "./toast";

/**
 * One way to run an action that changes data: the whole thing (the request and the page refresh that follows) counts as
 * pending, a second tap while it runs is ignored, a failure becomes `error`, and a success can say so in a toast.
 */
export function useAction() {
  const router = useRouter();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [refreshing, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const run = useCallback(
    async (
      call: () => Promise<ApiResult<unknown>>,
      opts: { success?: string | ((data: unknown) => string | undefined); refresh?: boolean } = {},
    ): Promise<boolean> => {
      if (busy.current) return false;
      busy.current = true;
      setSending(true);
      setError(null);
      try {
        const res = await call();
        if (!res.ok) {
          setError(res.error);
          return false;
        }
        const message = typeof opts.success === "function" ? opts.success(res.data) : opts.success;
        if (message) toast(message);
        if (opts.refresh !== false) startTransition(() => router.refresh());
        return true;
      } finally {
        busy.current = false;
        setSending(false);
      }
    },
    [router, toast],
  );

  return { run, pending: sending || refreshing, error, setError };
}
