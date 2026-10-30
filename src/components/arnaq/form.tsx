import type { ReactNode } from "react";

export const inputClass =
  "bg-soft border-hair focus-visible:border-accent min-h-11 w-full rounded-xl border px-3 text-base outline-none";

export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="grid gap-1.5 text-sm font-medium">
      {label}
      {children}
      {hint && <span className="text-ink-muted text-[13px] font-normal">{hint}</span>}
    </label>
  );
}

export function PrimaryButton({ children, ...rest }: React.ComponentProps<"button">) {
  return (
    <button
      {...rest}
      className="bg-action text-action-ink min-h-11 rounded-full px-5 text-[15px] font-semibold transition-transform active:scale-[.97] disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      {children}
    </button>
  );
}

export function GhostButton({ children, ...rest }: React.ComponentProps<"button">) {
  return (
    <button
      {...rest}
      className="bg-soft text-accent min-h-11 rounded-full px-4 text-[15px] font-semibold transition-transform active:scale-[.97] disabled:opacity-50 motion-reduce:transition-none motion-reduce:active:scale-100"
    >
      {children}
    </button>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  return message ? (
    <p role="alert" className="text-bad text-sm font-medium">
      {message}
    </p>
  ) : null;
}
