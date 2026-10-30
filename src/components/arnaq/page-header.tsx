import { ChevronLeft, ChevronRight } from "lucide-react";
import { StepLink } from "./step-link";
import type { ReactNode } from "react";

/** Serif page title with an optional subtitle and a month stepper. */
export function PageHeader({
  title,
  sub,
  step,
}: {
  title: string;
  sub?: ReactNode;
  step?: { prev: string; next: string; prevLabel: string; nextLabel: string };
}) {
  return (
    <header className="flex items-end justify-between gap-3 pt-2 pb-4">
      <div className="min-w-0">
        {sub && <p className="text-ink-muted mb-1 text-sm">{sub}</p>}
        <h1 className="font-display text-[34px] leading-[1.1] font-medium tracking-tight text-balance @min-[900px]/app:text-[40px]">
          {title}
        </h1>
      </div>
      {step && (
        <div className="flex shrink-0 gap-2">
          <StepLink
            href={step.prev}
            label={step.prevLabel}
            className="liquid grid size-11 place-items-center rounded-full"
          >
            <ChevronLeft className="size-[18px]" />
          </StepLink>
          <StepLink
            href={step.next}
            label={step.nextLabel}
            className="liquid grid size-11 place-items-center rounded-full"
          >
            <ChevronRight className="size-[18px]" />
          </StepLink>
        </div>
      )}
    </header>
  );
}

/** Section heading inside a screen. */
export function Section({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="mt-8">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-1">
        <h2 className="font-display text-2xl font-medium tracking-tight">{title}</h2>
        {aside && <span className="text-ink-muted text-sm">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
