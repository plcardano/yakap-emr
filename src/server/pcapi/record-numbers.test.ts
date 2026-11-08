import { randomInt } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { formatRecordNumber, manilaDate } from "./record-number-format";

describe("record number format", () => {
  it("matches the guide's example", () => {
    expect(formatRecordNumber("S", "H12345678", "2026-10-25", 1)).toBe(
      "SH123456782026102500001",
    );
  });

  it("is always 23 characters", () => {
    expect(formatRecordNumber("T", "H12345678", "2026-01-01", 99999)).toHaveLength(23);
  });

  it("refuses a series past the 5-digit limit", () => {
    expect(() => formatRecordNumber("T", "H12345678", "2026-01-01", 100000)).toThrow();
  });

  it("rolls over at midnight Philippine time, not UTC", () => {
    expect(manilaDate(new Date("2026-10-25T15:59:59Z"))).toBe("2026-10-25");
    expect(manilaDate(new Date("2026-10-25T16:00:00Z"))).toBe("2026-10-26");
  });
});

// Needs the Docker database, so it is skipped where DATABASE_URL is not set, as in CI.
describe.runIf(process.env.DATABASE_URL)("nextRecordNumber", () => {
  const accreNo = `T${String(randomInt(99999999)).padStart(8, "0")}`;
  let facility: { id: string; accreNo: string };

  beforeAll(async () => {
    const { db } = await import("@/server/db");
    const { facilities } = await import("@/server/db/schema");
    [facility] = await db
      .insert(facilities)
      .values({ accreNo, name: "Record number test" })
      .returning({ id: facilities.id, accreNo: facilities.accreNo });
  });

  afterAll(async () => {
    const { db } = await import("@/server/db");
    const { facilities, recordCounters } = await import("@/server/db/schema");
    await db.delete(recordCounters).where(eq(recordCounters.facilityId, facility.id));
    await db.delete(facilities).where(eq(facilities.id, facility.id));
  });

  it("gives every concurrent caller a different number, in one series per prefix", async () => {
    const { nextRecordNumber } = await import("./record-numbers");
    const numbers = await Promise.all(
      Array.from({ length: 50 }, () => nextRecordNumber(facility, "S")),
    );
    expect(new Set(numbers).size).toBe(50);
    expect(numbers.map((n) => Number(n.slice(-5))).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    expect((await nextRecordNumber(facility, "T")).slice(-5)).toBe("00001");
  });

  it("restarts the series on a new day", async () => {
    const { nextRecordNumber } = await import("./record-numbers");
    const next = await nextRecordNumber(facility, "P", new Date("2031-05-01T00:00:00Z"));
    expect(next.slice(-5)).toBe("00001");
  });
});
