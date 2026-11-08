import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { recordCounters } from "@/server/db/schema";
import { formatRecordNumber, manilaDate, type RecordPrefix } from "./record-number-format";

/** Issues the next number. The upsert makes concurrent calls safe. */
export async function nextRecordNumber(
  facility: { id: string; accreNo: string },
  prefix: RecordPrefix,
  at: Date = new Date(),
) {
  const counterDate = manilaDate(at);
  const [{ lastValue }] = await db
    .insert(recordCounters)
    .values({ facilityId: facility.id, prefix, counterDate, lastValue: 1 })
    .onConflictDoUpdate({
      target: [recordCounters.facilityId, recordCounters.prefix, recordCounters.counterDate],
      set: { lastValue: sql`${recordCounters.lastValue} + 1` },
    })
    .returning({ lastValue: recordCounters.lastValue });
  return formatRecordNumber(prefix, facility.accreNo, counterDate, lastValue);
}
