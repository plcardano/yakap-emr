"use server";

import { redirect } from "next/navigation";
import type { Values } from "@/lib/upload-forms/types";
import { requireUser } from "@/server/auth/session";
import { createChildDraft, createConsultationDraft, type ChildForm } from "@/server/uploads/clinical";
import {
  correctSubmission,
  deleteDraft,
  loadCodes,
  saveDraft,
  submitDraft,
  type SubmitInput,
} from "@/server/uploads/service";

export async function saveDraftAction(id: string, values: Values, step: number) {
  return saveDraft(await requireUser(), id, values, step);
}

export async function deleteDraftAction(id: string, exitHref: string) {
  await deleteDraft(await requireUser(), id);
  redirect(exitHref);
}

export async function submitDraftAction(input: SubmitInput) {
  return submitDraft(await requireUser(), input);
}

export async function loadCodesAction(library: string, parent?: string) {
  await requireUser();
  return loadCodes(library, parent);
}

export async function correctSubmissionAction(id: string) {
  const corrected = await correctSubmission(await requireUser(), id);
  if (!corrected) redirect("/clinical");
  redirect(`${corrected.form === "fpe" ? "/fpe" : "/clinical"}/${corrected.draftId}`);
}

export async function createConsultationAction(input: { patient_pin: string; consent: boolean }) {
  return createConsultationDraft(await requireUser(), input);
}

export async function createChildAction(parentId: string, form: ChildForm) {
  const draftId = await createChildDraft(await requireUser(), parentId, form);
  redirect(draftId ? `/clinical/${draftId}` : "/clinical");
}
