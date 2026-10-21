"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { SwapLoader } from "./motion";
import type { Messages } from "@/i18n/messages";

/** Calm placeholder while a screen loads: same footprint as the hero, no spinner. */
export function HeroSkeleton({ screen }: { screen: keyof Messages["ui"]["states"]["loading"] }) {
  const { t } = useI18n();
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center gap-5 pt-2">
      <span className="sr-only">{t.ui.states.loading[screen]}</span>
      <div className="grid size-56 place-items-center">
        <SwapLoader />
      </div>
      <div className="shimmer h-6 w-64 max-w-full rounded-full" />
      <div className="mt-6 grid w-full grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="glass shimmer h-24" />
        ))}
      </div>
    </div>
  );
}

/** Nothing here yet: say what to do next, with one clear action. */
export function EmptyState({
  title,
  children,
  action,
  extra,
}: {
  title: string;
  children: ReactNode;
  action?: { href: string; label: string };
  /** A second, quieter action (for example the sample data button). */
  extra?: ReactNode;
}) {
  return (
    <div className="glass mt-4 grid justify-items-center gap-3 px-6 py-10 text-center">
      <span className="bg-soft text-accent grid size-12 place-items-center rounded-2xl">
        <Inbox className="size-6" />
      </span>
      <h2 className="font-display text-2xl font-medium">{title}</h2>
      <p className="text-ink-muted max-w-[44ch] text-[15px]">{children}</p>
      {action && (
        <Link
          href={action.href}
          className="bg-action text-action-ink mt-1 inline-flex min-h-11 items-center rounded-full px-5 text-[15px] font-semibold"
        >
          {action.label}
        </Link>
      )}
      {extra}
    </div>
  );
}
