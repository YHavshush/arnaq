"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

/** Away from the app for a minute or more, then back: fetch fresh numbers (an installed app has no pull to refresh). */
export function FocusRefresh({ afterMs = 60_000 }: { afterMs?: number }) {
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const onChange = () => {
      if (document.visibilityState === "hidden") hiddenAt.current = Date.now();
      else if (hiddenAt.current !== null) {
        if (Date.now() - hiddenAt.current >= afterMs) router.refresh();
        hiddenAt.current = null;
      }
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [router, afterMs]);
  return null;
}
