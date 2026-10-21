"use client";

import { useLayoutEffect } from "react";
import type { Mood } from "@/design/tokens";

/** Tells the page background which tone the active screen has (see DESIGN.md, status wash). */
export function MoodSetter({ mood }: { mood: Mood }) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.setAttribute("data-mood", mood);
    return () => root.removeAttribute("data-mood");
  }, [mood]);
  return null;
}
