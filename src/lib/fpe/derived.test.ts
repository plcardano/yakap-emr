import { describe, expect, it } from "vitest";
import { ageOn, ageText, computeBmi } from "./derived";

describe("patient age", () => {
  it("matches the guide's FPE sample", () => {
    expect(ageText("07/04/1990", "10/23/2026")).toBe("36 YR(S), 3 MO(S), 19 DAY(S)");
  });

  it("handles a birthday not yet reached this year", () => {
    expect(ageText("12/25/2000", "12/24/2026")).toBe("25 YR(S), 11 MO(S), 29 DAY(S)");
  });

  it("is exact on a birthday", () => {
    expect(ageText("03/15/2020", "03/15/2026")).toBe("6 YR(S), 0 MO(S), 0 DAY(S)");
  });

  it("borrows the right number of days across February", () => {
    expect(ageText("01/31/2026", "03/01/2026")).toBe("0 YR(S), 1 MO(S), 1 DAY(S)");
  });

  it("gives total months for age-based rules", () => {
    expect(ageOn("01/01/2024", "07/15/2026")?.totalMonths).toBe(30);
  });

  it("returns nothing for missing dates or a birth date in the future", () => {
    expect(ageText("", "10/23/2026")).toBe("");
    expect(ageText("10/24/2026", "10/23/2026")).toBe("");
  });
});

describe("BMI", () => {
  it("matches the guide's FPE sample", () => {
    expect(computeBmi(60.5, 160)).toBe(23.63);
  });

  it("is undefined without both measurements", () => {
    expect(computeBmi(60, "")).toBeUndefined();
    expect(computeBmi("", 160)).toBeUndefined();
  });
});
