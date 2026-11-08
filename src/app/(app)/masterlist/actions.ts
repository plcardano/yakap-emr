"use server";

import { requireUser } from "@/server/auth/session";
import {
  downloadBatch,
  lookupAssignment,
  type BatchInput,
  type IndividualInput,
} from "@/server/records/service";

export async function lookupAssignmentAction(input: IndividualInput) {
  return lookupAssignment(await requireUser(), input);
}

export async function downloadBatchAction(input: BatchInput) {
  return downloadBatch(await requireUser(), input);
}
