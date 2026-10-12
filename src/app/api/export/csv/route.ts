import { getDb } from "@/db";
import { requestTime, todayIso } from "@/lib/api";
import { transactionsCsv } from "@/lib/export";

/** GET /api/export/csv: all transactions as a spreadsheet file. */
export async function GET() {
  await requestTime();
  return new Response(await transactionsCsv(await getDb()), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="kasboek-transacties-${todayIso()}.csv"`,
      "cache-control": "no-store",
    },
  });
}
