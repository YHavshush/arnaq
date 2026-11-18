import Link from "next/link";
import type { LegalDoc } from "@/i18n/messages/en/legal";

/** A long document (the privacy notice, the terms) as a calm reading page: sections, paragraphs, bullets and one table. */
export function LegalDocument({
  doc,
  updated,
  back,
}: {
  doc: LegalDoc;
  updated: string;
  back: string;
}) {
  return (
    <main id="main" className="mx-auto grid w-full max-w-[44rem] gap-8 px-4 py-10">
      <header className="grid gap-3">
        <Link href="/" className="text-ink-muted text-sm underline underline-offset-4">
          {back}
        </Link>
        <h1 className="font-display text-[32px] leading-tight font-medium text-balance">
          {doc.title}
        </h1>
        <p className="text-ink-muted text-sm">{updated}</p>
        <p className="text-[17px] leading-relaxed">{doc.intro}</p>
      </header>
      {doc.sections.map((section) => (
        <section key={section.heading} className="grid gap-3">
          <h2 className="font-display text-[22px] leading-snug font-medium">{section.heading}</h2>
          {section.paragraphs.map((p) => (
            <p key={p} className="text-[16px] leading-relaxed">
              {p}
            </p>
          ))}
          {section.bullets.length > 0 && (
            <ul className="grid list-disc gap-2 pl-5 text-[16px] leading-relaxed">
              {section.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {section.table && (
            <div className="border-hair overflow-x-auto rounded-2xl border">
              <table className="w-full min-w-[32rem] border-collapse text-left text-[14.5px]">
                <thead>
                  <tr className="bg-soft">
                    {section.table.head.map((h) => (
                      <th key={h} scope="col" className="px-3 py-2 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {section.table.rows.map((row) => (
                    <tr key={row[0]} className="border-hair border-t align-top">
                      {row.map((cell) => (
                        <td key={cell} className="px-3 py-2 leading-snug">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ))}
    </main>
  );
}
