import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { initialFpeValues, type Values } from "@/lib/fpe/form";
import { pcapiFor } from "@/server/pcapi";
import { failureCode, fieldFailure, requestIdOf, toFailure } from "@/server/verification/failure";
import {
  correctSubmission,
  createDraft,
  deleteDraft,
  draftEvidence as uploadEvidence,
  listUploads,
  loadCodes,
  loadDraft,
  logEntry,
  recordConsent,
  saveDraft,
  submitDraft,
  type Actor,
  type DraftContent,
  type SubmitInput,
  type UploadItem,
} from "@/server/uploads/service";

export type { Actor };
export type FpeDraftContent = DraftContent;
export type SubmitFpeInput = SubmitInput;
export type FpeListItem = UploadItem;
export { loadCodes };

export async function createFpeDraft(
  actor: Actor,
  input: { patient_pin: string; consent: boolean },
): Promise<ActionResult<{ draftId: string }>> {
  if (!input.consent) return fieldFailure({ consent: "Confirm the patient's consent first." });
  if (!/^\d{12}$/.test(input.patient_pin)) {
    return fieldFailure({ patient_pin: "Enter exactly 12 digits, with no dashes or spaces." });
  }

  await recordConsent(actor, input.patient_pin, "fpe");
  try {
    // The Masterlist returns dates in the FPE's format, so values copy over directly.
    const { data, requestId } = await pcapiFor(actor.accreNo).masterlistIndividual({
      patient_pin: input.patient_pin,
      eff_year: "",
      consent: true,
    });
    const row = data.assignments[0];
    const values = initialFpeValues({
      patient_pin: row.patient_pin,
      patient_type: row.patient_type,
      patient_fname: row.patient_fname,
      patient_mname: row.patient_mname,
      patient_lname: row.patient_lname,
      patient_extname: row.patient_extname,
      patient_sex: row.patient_sex,
      patient_dob: row.patient_dob,
      patient_mobile_no: row.patient_mobile_no,
      patient_landline_no: row.patient_landline_no,
      assignment_date: row.assignment_date,
      assignment_status: row.assignment_status,
    });
    const draftId = await createDraft(actor, "fpe", input.patient_pin, { values, step: 0 });
    await logEntry(actor, "fpe.draft_created", { patient_pin: input.patient_pin }, requestId);
    return { ok: true, data: { draftId }, requestId };
  } catch (error) {
    await logEntry(
      actor,
      "pcapi.masterlist.failed",
      { patient_pin: input.patient_pin, issue: failureCode(error) },
      requestIdOf(error),
    );
    return toFailure(error);
  }
}

export async function loadFpeDraft(actor: Actor, id: string) {
  const draft = await loadDraft(actor, id);
  return draft?.form === "fpe" ? draft.content : null;
}

export const saveFpeDraft = saveDraft;
export const deleteFpeDraft = deleteDraft;
export const submitFpe = submitDraft;

export function draftEvidence(actor: Actor, values: Values) {
  return uploadEvidence(actor, "fpe", values);
}

export async function correctFpeSubmission(actor: Actor, submissionId: string) {
  return (await correctSubmission(actor, submissionId))?.draftId ?? null;
}

export function listFpe(actor: Actor) {
  return listUploads(actor, ["fpe"]);
}
