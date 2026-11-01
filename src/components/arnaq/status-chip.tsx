import { Check } from "lucide-react";

type Status = "matched" | "expected" | "missed" | "late" | "idle";

const STYLE: Record<Status, string> = {
  matched: "bg-good/12 text-good",
  expected: "bg-[color-mix(in_srgb,var(--ring-accent-to)_18%,transparent)] text-accent",
  missed: "bg-bad/12 text-bad",
  late: "bg-warn/12 text-warn",
  idle: "bg-soft text-ink-muted",
};

/**
 * Paid, still to come or missed, in words first (the label) with colour and a check mark behind
 * it: green with a check for paid, amber with a check for paid late, blue for due, rose for
 * missed, and a quiet grey for paused or nothing this month.
 */
export function StatusChip({ status, label }: { status: Status; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-semibold ${STYLE[status]}`}
    >
      {(status === "matched" || status === "late") && (
        <Check aria-hidden className="size-3" strokeWidth={3} />
      )}
      {label}
    </span>
  );
}
