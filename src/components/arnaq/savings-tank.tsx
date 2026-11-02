import type { CSSProperties } from "react";

/**
 * The savings goal as a glass tank that fills to `level` (0 to 1). The liquid rises once when the screen opens, then its
 * surface drifts slowly (see `.arnaq-tank` in globals.css). Only transform moves, never a filter; without motion it just
 * stands at its level. Once the goal is reached it turns green and is full. Decorative: the numbers next to it say it.
 */
export function SavingsTank({
  level,
  reached,
  size = "sm",
  className = "",
}: {
  level: number;
  reached: boolean;
  size?: "xs" | "sm" | "lg";
  className?: string;
}) {
  const from = reached ? "var(--ring-good-from)" : "var(--ring-accent-from)";
  const to = reached ? "var(--ring-good-to)" : "var(--ring-accent-to)";
  const box: CSSProperties =
    size === "lg"
      ? { width: 92, height: 132, borderRadius: "20px 20px 28px 28px" }
      : size === "xs"
        ? { width: 22, height: 38, borderRadius: "8px 8px 11px 11px" }
        : { width: 42, height: 68, borderRadius: "14px 14px 18px 18px" };
  return (
    <div
      aria-hidden
      className={`arnaq-tank ${className}`}
      style={
        {
          ...box,
          "--p": Math.max(0, Math.min(level, 1)),
          "--tank-a": from,
          "--tank-b": to,
        } as CSSProperties
      }
    >
      <div className="arnaq-tank-level">
        <svg className="arnaq-tank-wave" viewBox="0 0 80 8" preserveAspectRatio="none">
          <path d="M0 4 Q10 0 20 4 T40 4 T60 4 T80 4 V8 H0Z" />
        </svg>
      </div>
    </div>
  );
}
