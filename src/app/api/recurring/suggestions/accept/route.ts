import { getDb } from "@/db";
import { handle, isInt, todayIso } from "@/lib/api";
import { isObject } from "@/lib/recurring/input";
import type { RecurringType } from "@/lib/recurring/occurrences";
import { acceptSuggestion } from "@/lib/recurring/suggestions";

const optionalInt = (v: unknown) => v === undefined || isInt(v);

/**
 * POST JSON: { key, type, name?, expectedAmount?, tolerance?, dayOfMonth?, categoryId? }.
 * 201 with the new item, or 200 with the existing one when it was accepted before.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body: unknown = await request.json();
    if (
      !isObject(body) ||
      typeof body.key !== "string" ||
      typeof body.type !== "string" ||
      !(body.name === undefined || typeof body.name === "string") ||
      !optionalInt(body.expectedAmount) ||
      !optionalInt(body.tolerance) ||
      !optionalInt(body.dayOfMonth) ||
      !(optionalInt(body.categoryId) || body.categoryId === null)
    ) {
      return Response.json(
        { error: "key and type are required; overrides must be numbers (cents) or strings." },
        { status: 400 },
      );
    }
    const { item, created } = acceptSuggestion(
      getDb(),
      {
        key: body.key,
        type: body.type as RecurringType,
        name: body.name as string | undefined,
        expectedAmount: body.expectedAmount as number | undefined,
        tolerance: body.tolerance as number | undefined,
        dayOfMonth: body.dayOfMonth as number | undefined,
        categoryId: body.categoryId as number | null | undefined,
      },
      { today: todayIso() },
    );
    return Response.json({ item, created }, { status: created ? 201 : 200 });
  });
}
