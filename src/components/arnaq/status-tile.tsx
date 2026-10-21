import type { Tone } from "@/design/tokens";
import type { Tile } from "@/lib/view/overzicht";
import { SavingsProgress } from "./savings-progress";

const DOT: Record<Tone, string> = {
  accent: "var(--ring-accent-to)",
  good: "var(--ring-good-to)",
  warn: "var(--ring-warn-to)",
  bad: "var(--ring-bad-to)",
};

/** Label, one status word, short sub-line. Status is words first; the dot only backs it up. */
export function StatusTile({ tile, className = "" }: { tile: Tile; className?: string }) {
  // A savings goal is shown as a progress card across the width, like the one in the introduction.
  if (tile.goal)
    return (
      <SavingsProgress
        className="col-span-2 @min-[900px]/app:col-span-1"
        label={tile.label}
        word={tile.word}
        sub={tile.sub}
        saved={tile.goal.saved}
        target={tile.goal.target}
        tone={tile.tone}
      />
    );
  return (
    <div className={`glass p-4 ${className}`}>
      <div className="text-ink-muted text-[13px]">{tile.label}</div>
      <div className="num my-0.5 flex items-center gap-2 text-xl leading-tight font-semibold tracking-tight">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full"
          style={{ background: DOT[tile.tone] }}
        />
        {tile.word}
      </div>
      <div className="text-ink-muted text-[13px]">{tile.sub}</div>
    </div>
  );
}
