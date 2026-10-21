import type { Sentence } from "@/lib/view/overzicht";

/** A serif sentence; emphasised parts (numbers, month names) are italic. */
export function SentenceText({ parts }: { parts: Sentence }) {
  return (
    <>
      {parts.map((p, i) =>
        p.em ? (
          <em key={i} className="num italic">
            {p.text}
          </em>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
