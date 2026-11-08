"use server";

import { requireUser } from "@/server/auth/session";
import { createFpeDraft } from "@/server/fpe/service";

export async function createDraftAction(input: { patient_pin: string; consent: boolean }) {
  return createFpeDraft(await requireUser(), input);
}
