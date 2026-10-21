"use client";

import { Repeat, TrendingUp, Upload, WalletCards, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { Wordmark } from "./logo";

const ITEMS: {
  href: string;
  key: "overview" | "forecast" | "fixedCosts" | "upload";
  icon: LucideIcon;
}[] = [
  { href: "/", key: "overview", icon: WalletCards },
  { href: "/forecast", key: "forecast", icon: TrendingUp },
  { href: "/fixed-costs", key: "fixedCosts", icon: Repeat },
  { href: "/upload", key: "upload", icon: Upload },
];

const isActive = (path: string, href: string) =>
  href === "/" ? path === "/" : path.startsWith(href);

/** Sidebar on a wide app, floating pill on a narrow one. `badge` goes on Upload (open items). */
export function Nav({ badge }: { badge?: ReactNode }) {
  const path = usePathname();
  const { t } = useI18n();
  return (
    <>
      <nav
        aria-label={t.ui.nav.label}
        className="glass-nav fixed bottom-[calc(12px+env(safe-area-inset-bottom,0px))] left-1/2 z-20 grid w-[min(440px,calc(100%-24px))] -translate-x-1/2 grid-cols-4 rounded-full p-1.5 @min-[900px]/app:hidden"
      >
        {ITEMS.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(path, href) ? "page" : undefined}
            className="text-ink-muted aria-[current=page]:bg-accent aria-[current=page]:text-accent-ink relative grid min-h-12 justify-items-center gap-0.5 rounded-full px-1 py-1.5 text-[11.5px] font-semibold"
          >
            <Icon className="size-5" />
            {t.ui.nav[key]}
            {href === "/upload" && badge}
          </Link>
        ))}
      </nav>
      <aside className="glass-nav sticky top-0 hidden h-dvh flex-col gap-1 self-start border-y-0 border-s-0 px-3 py-5 @min-[900px]/app:flex">
        <div className="px-3 pb-5">
          <Wordmark title={t.ui.brand} className="h-6 w-auto" />
        </div>
        {ITEMS.map(({ href, key, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            aria-current={isActive(path, href) ? "page" : undefined}
            className="text-ink-muted hover:bg-soft aria-[current=page]:bg-soft aria-[current=page]:text-accent flex min-h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium"
          >
            <Icon className="size-[18px]" />
            {t.ui.nav[key]}
            {href === "/upload" && badge}
          </Link>
        ))}
      </aside>
    </>
  );
}
