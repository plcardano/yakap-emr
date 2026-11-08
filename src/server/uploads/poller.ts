import "server-only";
import { and, asc, eq, inArray, lte } from "drizzle-orm";
import { audit } from "@/server/audit/log";
import { db } from "@/server/db";
import { facilities, submissions } from "@/server/db/schema";
import { pcapiFor } from "@/server/pcapi";
import { failureCode, requestIdOf } from "@/server/verification/failure";

const MAX_DELAY_SECONDS = 60;
const BATCH_SIZE = 25;

/** 2, 4, 8 seconds and so on, capped at 60 (guide 4.6.7). */
export function pollDelaySeconds(attempts: number) {
  return Math.min(2 ** (attempts + 1), MAX_DELAY_SECONDS);
}

function nextPoll(attempts: number) {
  return new Date(Date.now() + pollDelaySeconds(attempts) * 1000);
}

/** Checks every submission that is due and returns how many were checked. */
export async function pollDueUploads() {
  const due = await db
    .select({ submission: submissions, accreNo: facilities.accreNo })
    .from(submissions)
    .innerJoin(facilities, eq(submissions.facilityId, facilities.id))
    .where(
      and(
        inArray(submissions.processingStatus, ["queued", "processing"]),
        lte(submissions.nextPollAt, new Date()),
      ),
    )
    .orderBy(asc(submissions.nextPollAt))
    .limit(BATCH_SIZE);

  for (const { submission, accreNo } of due) {
    const attempts = submission.pollAttempts + 1;
    try {
      const { data } = await pcapiFor(accreNo).uploadStatus(submission.uploadTransactionNo ?? "");
      const finished = data.processing_status === "accepted" || data.processing_status === "rejected";
      await db
        .update(submissions)
        .set({
          processingStatus: data.processing_status,
          errors: data.errors,
          receivedAt: new Date(`${data.received_at}+08:00`),
          processedAt: data.processed_at ? new Date(`${data.processed_at}+08:00`) : null,
          pollAttempts: attempts,
          nextPollAt: finished ? null : nextPoll(attempts),
        })
        .where(eq(submissions.id, submission.id));
    } catch (error) {
      await db
        .update(submissions)
        .set({ pollAttempts: attempts, nextPollAt: nextPoll(attempts) })
        .where(eq(submissions.id, submission.id));
      await audit({
        action: "pcapi.upload_status.failed",
        facilityId: submission.facilityId,
        requestId: requestIdOf(error),
        details: { issue: failureCode(error) },
      });
    }
  }
  return due.length;
}
