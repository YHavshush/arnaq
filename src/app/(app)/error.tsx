"use client";

import { TriangleAlert } from "lucide-react";

/** Something threw while loading a screen (usually the database). Never show the raw error. */
export default function ErrorScreen({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="glass mt-6 grid justify-items-center gap-3 px-6 py-10 text-center">
      <span className="bg-soft text-warn grid size-12 place-items-center rounded-2xl">
        <TriangleAlert className="size-6" />
      </span>
      <h1 className="font-display text-2xl font-medium">Dit lukt even niet</h1>
      <p className="text-ink-muted max-w-[44ch] text-[15px]">
        Er ging iets mis bij het ophalen van je gegevens. Er is niets kwijt; probeer het zo nog
        eens.
      </p>
      <button
        type="button"
        onClick={reset}
        className="bg-accent text-accent-ink mt-1 min-h-11 rounded-full px-5 text-[15px] font-semibold"
      >
        Opnieuw proberen
      </button>
    </div>
  );
}
