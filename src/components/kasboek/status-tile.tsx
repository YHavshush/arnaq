import type { Tone } from "@/design/tokens";
import type { Tile } from "@/lib/view/overzicht";

const DOT: Record<Tone, string> = {
  accent: "var(--ring-accent-to)",
  good: "var(--ring-good-to)",
  warn: "var(--ring-warn-to)",
  bad: "var(--ring-bad-to)",
};

/** Label, one status word, short sub-line. Status is words first; the dot only backs it up. */
export function StatusTile({ tile }: { tile: Tile }) {
  return (
    <div className="glass p-4">
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
