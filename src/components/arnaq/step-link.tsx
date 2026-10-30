"use client";

import Link, { useLinkStatus } from "next/link";
import type { ReactNode } from "react";

/** Dims its content while the link's page is loading, so a tap on a month or a horizon visibly did something. */
function Pending({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span
      className={`inline-flex items-center justify-center transition-opacity duration-150 ${pending ? "animate-pulse opacity-50" : ""}`}
    >
      {children}
    </span>
  );
}

/** A link between months (or horizons) of the same screen, with a loading cue. */
export function StepLink({
  href,
  label,
  className,
  current,
  children,
}: {
  href: string;
  label?: string;
  className: string;
  current?: boolean;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={current ? "true" : undefined}
      className={className}
    >
      <Pending>{children}</Pending>
    </Link>
  );
}
