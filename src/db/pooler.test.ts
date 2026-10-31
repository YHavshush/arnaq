import { describe, expect, it } from "vitest";
import { forTransactionPooler } from "./pooler";

describe("forTransactionPooler", () => {
  it("moves a Supabase session pooler URL to the transaction pooler, keeping the rest", () => {
    expect(
      forTransactionPooler(
        "postgresql://app.ref:p%40ss@aws-0-eu-central-1.pooler.supabase.com:5432/postgres",
      ),
    ).toBe("postgresql://app.ref:p%40ss@aws-0-eu-central-1.pooler.supabase.com:6543/postgres");
  });
  it("leaves other URLs alone", () => {
    for (const url of [
      "postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
      "postgresql://u:p@db.ref.supabase.co:5432/postgres",
      "postgresql://u:p@localhost:5432/app",
      "not a url",
    ])
      expect(forTransactionPooler(url)).toBe(url);
  });
});
