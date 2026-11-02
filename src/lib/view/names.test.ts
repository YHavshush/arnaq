import { describe, expect, it } from "vitest";
import { displayName } from "./names";

describe("displayName", () => {
  it("writes a shouted name as words, without the legal form, keeping short names in capitals", () => {
    expect(displayName("FBTO ZORGVERZEKERINGEN NV")).toBe("FBTO Zorgverzekeringen");
    expect(displayName("NETFLIX INTERNATIONAL B.V.")).toBe("Netflix International");
    expect(displayName("CLAUDE")).toBe("Claude");
    expect(displayName("NS REIZIGERS")).toBe("NS Reizigers");
  });
  it("leaves a name that already has lower case, and very short names, alone", () => {
    expect(displayName("Stichting DUWO")).toBe("Stichting DUWO");
    expect(displayName("featurn B.V.")).toBe("featurn");
    expect(displayName("Payment from OREN HAVSHUSH")).toBe("Payment from OREN HAVSHUSH");
    expect(displayName("ING")).toBe("ING");
  });
});
