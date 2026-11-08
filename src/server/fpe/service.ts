import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { ActionResult } from "@/lib/action-result";
import { createFpeChecker, initialFpeValues, type Values } from "@/lib/fpe/form";
import { librariesFor, rulesFor } from "@/lib/pcapi-spec";
import { audit } from "@/server/audit/log";
import { decryptAtRest, encryptAtRest, hmacPin } from "@/server/crypto/at-rest";
import { db } from "@/server/db";
import {
  consentRecords,
  drafts,
  externalCodes,
  patientCases,
  submissions,
} from "@/server/db/schema";
import { pcapiFor } from "@/server/pcapi";
import { nextRecordNumber } from "@/server/pcapi/record-numbers";
import {
  availableEvidence,
  evidenceFields,
  type VerificationMode,
} from "@/server/verification/evidence";
import {
  failureCode,
  fieldFailure,
  requestIdOf,
  toFailure,
  validationFailure,
} from "@/server/verification/failure";
import type { Actor as BaseActor } from "@/server/verification/service";

export type Actor = BaseActor & { username: string };

/** Record numbers are kept with the draft so a correction reuses them (guide 4.6). */
type RecordNumbers = {
  case_no: string;
  enlist_transaction_no: string;
  profile_transaction_no: string;
};

export type FpeDraftContent = {
  values: Values;
  step: number;
  numbers?: RecordNumbers;
  /** The rejected submission this draft corrects. */
  correctsSubmissionId?: string;
};

const checker = createFpeChecker(rulesFor("fpe"), librariesFor("fpe"));

async function recordConsent(actor: Actor, pin: string) {
  await db.insert(consentRecords).values({
    facilityId: actor.facilityId,
    recordedBy: actor.id,
    patientPinHmac: hmacPin(pin),
    subjectEncrypted: encryptAtRest(JSON.stringify({ patient_pin: pin })),
    purpose: "fpe",
  });
}

function logEntry(actor: Actor, action: string, details: Record<string, unknown>, requestId?: string) {
  return audit({ facilityId: actor.facilityId, userId: actor.id, action, requestId, details });
}

function patientName(values: Values) {
  const { patient_lname: last, patient_fname: first } = values.enlistment ?? {};
  return last ? `${last}, ${first ?? ""}`.trim() : "Unnamed patient";
}

export async function createFpeDraft(
  actor: Actor,
  input: { patient_pin: string; consent: boolean },
): Promise<ActionResult<{ draftId: string }>> {
  if (!input.consent) return fieldFailure({ consent: "Confirm the patient's consent first." });
  if (!/^\d{12}$/.test(input.patient_pin)) {
    return fieldFailure({ patient_pin: "Enter exactly 12 digits, with no dashes or spaces." });
  }

  await recordConsent(actor, input.patient_pin);
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
    const [draft] = await db
      .insert(drafts)
      .values({
        facilityId: actor.facilityId,
        createdBy: actor.id,
        form: "fpe",
        patientPinHmac: hmacPin(input.patient_pin),
        payloadEncrypted: encryptAtRest(JSON.stringify({ values, step: 0 })),
      })
      .returning({ id: drafts.id });
    await logEntry(actor, "fpe.draft_created", { patient_pin: input.patient_pin }, requestId);
    return { ok: true, data: { draftId: draft.id }, requestId };
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

function ownDraft(actor: Actor, id: string) {
  return and(eq(drafts.id, id), eq(drafts.facilityId, actor.facilityId), eq(drafts.form, "fpe"));
}

export async function loadFpeDraft(actor: Actor, id: string) {
  const [draft] = await db.select().from(drafts).where(ownDraft(actor, id)).limit(1);
  if (!draft) return null;
  return JSON.parse(decryptAtRest(draft.payloadEncrypted)) as FpeDraftContent;
}

export async function saveFpeDraft(actor: Actor, id: string, values: Values, step: number) {
  const current = await loadFpeDraft(actor, id);
  if (!current) return false;
  await db
    .update(drafts)
    .set({ payloadEncrypted: encryptAtRest(JSON.stringify({ ...current, values, step })) })
    .where(ownDraft(actor, id));
  return true;
}

export async function deleteFpeDraft(actor: Actor, id: string) {
  await db.delete(drafts).where(ownDraft(actor, id));
}

export async function draftEvidence(actor: Actor, values: Values) {
  return availableEvidence(actor, String(values.enlistment?.patient_pin ?? ""));
}

export async function loadCodes(library: string, parent?: string) {
  const rows = await db
    .select({ code: externalCodes.code, description: externalCodes.description })
    .from(externalCodes)
    .where(
      and(
        eq(externalCodes.library, library),
        eq(externalCodes.active, true),
        parent ? eq(externalCodes.parentCode, parent) : undefined,
      ),
    )
    .orderBy(externalCodes.description);
  return rows.map(({ code, description }) => ({ value: code, label: description }));
}

async function caseNumberFor(actor: Actor, pin: string, accre: { id: string; accreNo: string }) {
  const hmac = hmacPin(pin);
  const where = and(eq(patientCases.facilityId, actor.facilityId), eq(patientCases.patientPinHmac, hmac));
  const [existing] = await db.select().from(patientCases).where(where).limit(1);
  if (existing) return existing.caseNo;

  await db
    .insert(patientCases)
    .values({
      facilityId: actor.facilityId,
      patientPinHmac: hmac,
      caseNo: await nextRecordNumber(accre, "T"),
    })
    .onConflictDoNothing();
  const [row] = await db.select().from(patientCases).where(where).limit(1);
  return row.caseNo;
}

async function ensureNumbers(actor: Actor, draftId: string, content: FpeDraftContent) {
  if (content.numbers) return content.numbers;
  const facility = { id: actor.facilityId, accreNo: actor.accreNo };
  const numbers: RecordNumbers = {
    case_no: await caseNumberFor(actor, String(content.values.enlistment.patient_pin), facility),
    enlist_transaction_no: await nextRecordNumber(facility, "E"),
    profile_transaction_no: await nextRecordNumber(facility, "P"),
  };
  // Saved before the call, so a lost response cannot cause a second number.
  await db
    .update(drafts)
    .set({ payloadEncrypted: encryptAtRest(JSON.stringify({ ...content, numbers })) })
    .where(ownDraft(actor, draftId));
  return numbers;
}

export type SubmitFpeInput = {
  draftId: string;
  values: Values;
  consent: boolean;
};

export async function submitFpe(
  actor: Actor,
  { draftId, values, consent }: SubmitFpeInput,
): Promise<ActionResult<{ submissionId: string }>> {
  if (!consent) return fieldFailure({ consent: "Confirm the patient's consent first." });

  const content = await loadFpeDraft(actor, draftId);
  if (!content) return { ok: false, title: "This draft no longer exists" };

  const editable = checker.check(values);
  if (editable.issues.length) return validationFailure(editable.issues);

  const pin = String(values.enlistment.patient_pin);
  const mode = values.profile.patient_verification_mode as VerificationMode;
  const evidence = await evidenceFields(actor, pin, mode);
  if (!evidence) {
    return fieldFailure({
      "profile.patient_verification_mode": "This verification was not completed today.",
    });
  }

  const numbers = await ensureNumbers(actor, draftId, { ...content, values });
  const complete: Values = {
    ...values,
    consent: true,
    enlistment: {
      ...values.enlistment,
      accre_no: actor.accreNo,
      created_by: actor.username,
      case_no: numbers.case_no,
      enlist_transaction_no: numbers.enlist_transaction_no,
    },
    profile: {
      ...values.profile,
      ...evidence,
      profile_transaction_no: numbers.profile_transaction_no,
    },
  };

  const final = checker.check(complete, { accreNo: actor.accreNo, includeServerFilled: true });
  if (final.issues.length) return validationFailure(final.issues);

  await recordConsent(actor, pin);
  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).upload("fpe", final.body);
    const recordNumbers = {
      case_no: numbers.case_no,
      profile_transaction_no: numbers.profile_transaction_no,
    };
    const submissionId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(submissions)
        .values({
          facilityId: actor.facilityId,
          submittedBy: actor.id,
          form: "fpe",
          uploadTransactionNo: data.upload_transaction_no,
          processingStatus: data.processing_status,
          recordKey: numbers.profile_transaction_no,
          recordNumbers,
          payloadEncrypted: encryptAtRest(JSON.stringify({ values, numbers })),
          requestId,
          nextPollAt: new Date(),
        })
        .onConflictDoUpdate({
          target: submissions.uploadTransactionNo,
          set: { processingStatus: data.processing_status },
        })
        .returning({ id: submissions.id });
      if (content.correctsSubmissionId) {
        await tx
          .update(submissions)
          .set({ supersededAt: new Date() })
          .where(eq(submissions.id, content.correctsSubmissionId));
      }
      await tx.delete(drafts).where(ownDraft(actor, draftId));
      return row.id;
    });
    await logEntry(actor, "pcapi.upload.fpe", { patient_pin: pin }, requestId);
    return { ok: true, data: { submissionId }, requestId };
  } catch (error) {
    await logEntry(
      actor,
      "pcapi.upload.fpe.failed",
      { patient_pin: pin, issue: failureCode(error) },
      requestIdOf(error),
    );
    return toFailure(error);
  }
}

/** Opens a rejected submission for correction under the same record numbers. */
export async function correctFpeSubmission(actor: Actor, submissionId: string) {
  const [row] = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.facilityId, actor.facilityId),
        eq(submissions.form, "fpe"),
        eq(submissions.processingStatus, "rejected"),
        isNull(submissions.supersededAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const { values, numbers } = JSON.parse(decryptAtRest(row.payloadEncrypted)) as {
    values: Values;
    numbers: RecordNumbers;
  };
  const content: FpeDraftContent = {
    values,
    step: 0,
    numbers,
    correctsSubmissionId: row.id,
  };
  const [draft] = await db
    .insert(drafts)
    .values({
      facilityId: actor.facilityId,
      createdBy: actor.id,
      form: "fpe",
      patientPinHmac: hmacPin(String(values.enlistment.patient_pin)),
      payloadEncrypted: encryptAtRest(JSON.stringify(content)),
    })
    .returning({ id: drafts.id });
  return draft.id;
}

export type FpeListItem = {
  id: string;
  patient: string;
  status: "draft" | "queued" | "processing" | "accepted" | "rejected";
  updatedAt: string;
  uploadNo?: string;
  errors?: { field: string; issue: string }[];
};

export async function listFpe(actor: Actor): Promise<FpeListItem[]> {
  const draftRows = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.facilityId, actor.facilityId), eq(drafts.form, "fpe")))
    .orderBy(desc(drafts.updatedAt))
    .limit(50);
  const submissionRows = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.facilityId, actor.facilityId),
        eq(submissions.form, "fpe"),
        isNull(submissions.supersededAt),
      ),
    )
    .orderBy(desc(submissions.updatedAt))
    .limit(50);

  return [
    ...draftRows.map((row): FpeListItem => {
      const { values } = JSON.parse(decryptAtRest(row.payloadEncrypted)) as FpeDraftContent;
      return {
        id: row.id,
        patient: patientName(values),
        status: "draft",
        updatedAt: row.updatedAt.toISOString(),
      };
    }),
    ...submissionRows.map((row): FpeListItem => {
      const { values } = JSON.parse(decryptAtRest(row.payloadEncrypted)) as { values: Values };
      return {
        id: row.id,
        patient: patientName(values),
        status: row.processingStatus,
        updatedAt: row.updatedAt.toISOString(),
        uploadNo: row.uploadTransactionNo ?? undefined,
        errors: row.errors as FpeListItem["errors"],
      };
    }),
  ];
}
