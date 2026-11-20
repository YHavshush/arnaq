import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/client/api", () => ({ api: vi.fn() }));
import { api } from "@/lib/client/api";
import { syncBanks } from "./bank-sync";

const strings = {
  refreshed: (n: number) => `fetched ${n}`,
  refreshProblem: (a: string, p: string) => `${a}: ${p}`,
  refreshExpired: (a: string) => `${a} ended`,
};
const answer = (value: unknown) => vi.mocked(api).mockResolvedValue(value as never);

afterEach(() => vi.mocked(api).mockReset());

describe("syncBanks (the refresh behind the button and the pull down)", () => {
  it("adds up what was fetched and names every account that had a problem", async () => {
    answer({
      ok: true,
      data: {
        links: [
          { status: "ok", imported: 2, accountName: "A" },
          { status: "ok", imported: 3, accountName: "B" },
          { status: "expired", accountName: "C" },
          { status: "failed", accountName: "D", error: "boom" },
        ],
      },
    });
    expect(await syncBanks(strings)).toEqual({
      error: null,
      message: "fetched 5",
      problems: ["C ended", "D: boom"],
    });
    expect(api).toHaveBeenCalledWith("POST", "/api/banking/sync");
  });

  it("says nothing was fetched when no account answered, and passes a failed request on as the error", async () => {
    answer({ ok: true, data: { links: [{ status: "expired", accountName: "C" }] } });
    expect((await syncBanks(strings)).message).toBeNull();
    answer({ ok: false, error: "Too many requests." });
    expect(await syncBanks(strings)).toEqual({
      error: "Too many requests.",
      message: null,
      problems: [],
    });
  });
});
