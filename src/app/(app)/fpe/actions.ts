"use server";

import { redirect } from "next/navigation";
import type { Values } from "@/lib/fpe/form";
import { requireUser } from "@/server/auth/session";
import {
  correctFpeSubmission,
  createFpeDraft,
  deleteFpeDraft,
  loadCodes,
  saveFpeDraft,
  submitFpe,
  type SubmitFpeInput,
} from "@/server/fpe/service";

export async function createDraftAction(input: { patient_pin: string; consent: boolean }) {
  return createFpeDraft(await requireUser(), input);
}

export async function saveDraftAction(id: string, values: Values, step: number) {
  return saveFpeDraft(await requireUser(), id, values, step);
}

export async function deleteDraftAction(id: string) {
  await deleteFpeDraft(await requireUser(), id);
  redirect("/fpe");
}

export async function submitFpeAction(input: SubmitFpeInput) {
  return submitFpe(await requireUser(), input);
}

export async function correctSubmissionAction(id: string) {
  const draftId = await correctFpeSubmission(await requireUser(), id);
  redirect(draftId ? `/fpe/${draftId}` : "/fpe");
}

export async function loadCodesAction(library: string, parent?: string) {
  await requireUser();
  return loadCodes(library, parent);
}
