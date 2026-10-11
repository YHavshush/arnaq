import type { RecurringItemInput, RecurringItemPatch } from "./items";

type Kind = "string" | "number" | "boolean";

/** JSON shape of an item body. Values are checked for range and meaning by the library. */
const FIELDS: Record<keyof RecurringItemInput, { kind: Kind; nullable?: boolean }> = {
  name: { kind: "string" },
  type: { kind: "string" },
  matchCounterparty: { kind: "string", nullable: true },
  matchIban: { kind: "string", nullable: true },
  expectedAmount: { kind: "number" },
  tolerance: { kind: "number" },
  dayOfMonth: { kind: "number" },
  frequency: { kind: "string" },
  categoryId: { kind: "number", nullable: true },
  startDate: { kind: "string" },
  endDate: { kind: "string", nullable: true },
  active: { kind: "boolean" },
};

const REQUIRED: (keyof RecurringItemInput)[] = [
  "name",
  "type",
  "expectedAmount",
  "dayOfMonth",
  "startDate",
];

export type BodyResult<T> = { ok: true; value: T } | { ok: false; error: string };

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Check the JSON types of a recurring item body (HTTP 400 on failure). Unknown fields are
 * ignored. With `partial`, every field is optional (PATCH).
 */
export function readItemBody(body: unknown, partial: true): BodyResult<RecurringItemPatch>;
export function readItemBody(body: unknown, partial: false): BodyResult<RecurringItemInput>;
export function readItemBody(
  body: unknown,
  partial: boolean,
): BodyResult<RecurringItemInput | RecurringItemPatch> {
  if (!isObject(body)) return { ok: false, error: "Expected a JSON object." };
  const value: Record<string, unknown> = {};
  for (const [field, spec] of Object.entries(FIELDS)) {
    const v = body[field];
    if (v === undefined) continue;
    if (v === null ? !spec.nullable : typeof v !== spec.kind)
      return {
        ok: false,
        error: `${field} must be a ${spec.kind}${spec.nullable ? " or null" : ""}.`,
      };
    value[field] = v;
  }
  if (!partial) {
    const missing = REQUIRED.filter((f) => value[f] === undefined);
    if (missing.length) return { ok: false, error: `Missing: ${missing.join(", ")}.` };
  }
  return { ok: true, value: value as unknown as RecurringItemInput };
}
