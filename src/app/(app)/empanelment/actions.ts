"use server";

import { requireUser } from "@/server/auth/session";
import {
  loadTracker,
  recordEmpanelment,
  type RecordEmpanelmentInput,
} from "@/server/empanelment/service";
import type { LookupInput } from "@/server/verification/service";

export async function trackerAction(input: LookupInput) {
  return loadTracker(await requireUser(), input);
}

export async function recordAction(input: RecordEmpanelmentInput) {
  return recordEmpanelment(await requireUser(), input);
}
