"use client";

import { useEffect, useSyncExternalStore } from "react";
import { applyTheme, readTheme, subscribeTheme } from "@/design/theme-client";

/** Draws nothing. While "System" is the chosen theme, it follows the device when it switches light or dark. */
export function ThemeFollower() {
  const choice = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as const);
  useEffect(() => {
    if (choice !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => applyTheme("system");
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [choice]);
  return null;
}
