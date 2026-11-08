import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { ActionFailure, ActionResult } from "@/lib/action-result";
import { librariesFor, rulesFor, type UploadForm } from "@/lib/pcapi-spec";
import { createChecker } from "@/lib/upload-forms/checker";
import { FORM_DEFINITIONS } from "@/lib/upload-forms/registry";
import type { Values } from "@/lib/upload-forms/types";
import { audit } from "@/server/audit/log";
import { decryptAtRest, encryptAtRest, hmacPin } from "@/server/crypto/at-rest";
import { db } from "@/server/db";
import { consentRecords, drafts, externalCodes, patientCases, submissions } from "@/server/db/schema";
import { pcapiFor } from "@/server/pcapi";
import type { ProcessingStatus } from "@/server/pcapi/services";
import { nextRecordNumber } from "@/server/pcapi/record-numbers";
import type { RecordPrefix } from "@/server/pcapi/record-number-format";
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

export type Numbers = Record<string, string>;

export type ParentLink = { submissionId: string; numbers: Numbers; pcuCode?: string };

/** Record numbers are kept with the draft so a correction reuses them (guide 4.6). */
export type DraftContent = {
  values: Values;
  step: number;
  numbers?: Numbers;
  parent?: ParentLink;
  /** The rejected submission this draft corrects. */
  correctsSubmissionId?: string;
};

type StoredPayload = {
  values: Values;
  numbers: Numbers;
  pcuCode?: string;
  parent?: ParentLink;
};

const PRIMARY_NUMBER: Record<UploadForm, string> = {
  fpe: "profile_transaction_no",
  consultation: "soap_transaction_no",
  diagnostic_request: "request_transaction_no",
  diagnostic_results: "request_transaction_no",
  medicine: "meds_transaction_no",
  referral: "referral_transaction_no",
};

const checkers = new Map<UploadForm, ReturnType<typeof createChecker>>();

function checkerFor(form: UploadForm) {
  let checker = checkers.get(form);
  if (!checker) {
    checker = createChecker(FORM_DEFINITIONS[form], rulesFor(form), librariesFor(form));
    checkers.set(form, checker);
  }
  return checker;
}

export function encryptJson(value: unknown) {
  return encryptAtRest(JSON.stringify(value));
}

function decryptJson<T>(stored: string) {
  return JSON.parse(decryptAtRest(stored)) as T;
}

export async function recordConsent(actor: Actor, pin: string, purpose: string) {
  await db.insert(consentRecords).values({
    facilityId: actor.facilityId,
    recordedBy: actor.id,
    patientPinHmac: hmacPin(pin),
    subjectEncrypted: encryptJson({ patient_pin: pin }),
    purpose,
  });
}

export function logEntry(
  actor: Actor,
  action: string,
  details: Record<string, unknown>,
  requestId?: string,
) {
  return audit({ facilityId: actor.facilityId, userId: actor.id, action, requestId, details });
}

export async function createDraft(actor: Actor, form: UploadForm, pin: string, content: DraftContent) {
  const [draft] = await db
    .insert(drafts)
    .values({
      facilityId: actor.facilityId,
      createdBy: actor.id,
      form,
      patientPinHmac: hmacPin(pin),
      payloadEncrypted: encryptJson(content),
    })
    .returning({ id: drafts.id });
  return draft.id;
}

function ownDraft(actor: Actor, id: string) {
  return and(eq(drafts.id, id), eq(drafts.facilityId, actor.facilityId));
}

export async function loadDraft(actor: Actor, id: string) {
  const [draft] = await db.select().from(drafts).where(ownDraft(actor, id)).limit(1);
  if (!draft) return null;
  return { form: draft.form, content: decryptJson<DraftContent>(draft.payloadEncrypted) };
}

export async function saveDraft(actor: Actor, id: string, values: Values, step: number) {
  const current = await loadDraft(actor, id);
  if (!current) return false;
  await db
    .update(drafts)
    .set({ payloadEncrypted: encryptJson({ ...current.content, values, step }) })
    .where(ownDraft(actor, id));
  return true;
}

export async function deleteDraft(actor: Actor, id: string) {
  await db.delete(drafts).where(ownDraft(actor, id));
}

export async function draftEvidence(actor: Actor, form: UploadForm, values: Values) {
  const pin = FORM_DEFINITIONS[form].patientPin?.(values);
  return pin ? availableEvidence(actor, pin) : [];
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

export async function caseNumberFor(actor: Actor, pin: string, create: boolean) {
  const hmac = hmacPin(pin);
  const where = and(
    eq(patientCases.facilityId, actor.facilityId),
    eq(patientCases.patientPinHmac, hmac),
  );
  const [existing] = await db.select().from(patientCases).where(where).limit(1);
  if (existing || !create) return existing?.caseNo ?? null;

  await db
    .insert(patientCases)
    .values({
      facilityId: actor.facilityId,
      patientPinHmac: hmac,
      caseNo: await nextRecordNumber({ id: actor.facilityId, accreNo: actor.accreNo }, "T"),
    })
    .onConflictDoNothing();
  const [row] = await db.select().from(patientCases).where(where).limit(1);
  return row.caseNo;
}

type Completed = { body: Values; numbers: Numbers; pcuCode?: string; pin: string };

function pinOf(form: UploadForm, values: Values) {
  return FORM_DEFINITIONS[form].patientPin?.(values) ?? String(values.__patient?.pin ?? "");
}

async function issue(actor: Actor, prefix: RecordPrefix) {
  return nextRecordNumber({ id: actor.facilityId, accreNo: actor.accreNo }, prefix);
}

// Numbers are saved before the call, so a lost response cannot cause a second number.
async function issueNumbers(
  actor: Actor,
  draftId: string,
  content: DraftContent,
  build: () => Promise<Numbers>,
) {
  if (content.numbers) return content.numbers;
  const numbers = await build();
  await db
    .update(drafts)
    .set({ payloadEncrypted: encryptJson({ ...content, numbers }) })
    .where(ownDraft(actor, draftId));
  return numbers;
}

type Evidence = NonNullable<Awaited<ReturnType<typeof evidenceFields>>>;

const NOT_VERIFIED = "This verification was not completed today.";

async function fillForm(
  actor: Actor,
  form: UploadForm,
  draftId: string,
  content: DraftContent,
  values: Values,
): Promise<Completed | ActionFailure> {
  const pin = pinOf(form, values);
  const stored = { ...content, values };
  const parent = content.parent?.numbers ?? {};

  async function evidenceOr(field: string): Promise<Evidence | ActionFailure> {
    const group = field.split(".")[0];
    const mode = values[group].patient_verification_mode as VerificationMode;
    return (await evidenceFields(actor, pin, mode)) ?? fieldFailure({ [field]: NOT_VERIFIED });
  }

  switch (form) {
    case "fpe": {
      const evidence = await evidenceOr("profile.patient_verification_mode");
      if ("ok" in evidence) return evidence;
      const numbers = await issueNumbers(actor, draftId, stored, async () => ({
        case_no: (await caseNumberFor(actor, pin, true)) as string,
        enlist_transaction_no: await issue(actor, "E"),
        profile_transaction_no: await issue(actor, "P"),
      }));
      return {
        pin,
        numbers,
        body: {
          ...values,
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
        },
      };
    }
    case "consultation": {
      const evidence = await evidenceOr("soap.patient_verification_mode");
      if ("ok" in evidence) return evidence;
      const caseNo = await caseNumberFor(actor, pin, false);
      if (!caseNo) return { ok: false, title: "This patient has no FPE at your clinic" };
      const numbers = await issueNumbers(actor, draftId, stored, async () => ({
        case_no: caseNo,
        soap_transaction_no: await issue(actor, "S"),
      }));
      return {
        pin,
        numbers,
        pcuCode: evidence.pcu_transaction_code,
        body: {
          ...values,
          soap: { ...values.soap, ...evidence, ...numbers, created_by: actor.username },
        },
      };
    }
    case "diagnostic_request": {
      const numbers = await issueNumbers(actor, draftId, stored, async () => ({
        case_no: parent.case_no,
        soap_transaction_no: parent.soap_transaction_no,
        request_transaction_no: await issue(actor, "D"),
      }));
      return {
        pin,
        numbers,
        body: {
          ...values,
          diagrequest: values.diagrequest.map((row: Values) => ({ ...row, ...numbers })),
        },
      };
    }
    case "diagnostic_results": {
      const numbers = await issueNumbers(actor, draftId, stored, async () => {
        const results: Numbers = {};
        for (const row of values.diagresult_item as Values[]) {
          results[`result_${row.diagnostic_code}`] = await issue(actor, "L");
        }
        return {
          case_no: parent.case_no,
          soap_transaction_no: parent.soap_transaction_no,
          request_transaction_no: parent.request_transaction_no,
          ...results,
        };
      });
      return {
        pin,
        numbers,
        body: {
          ...values,
          diagnosticresult: {
            case_no: numbers.case_no,
            soap_transaction_no: numbers.soap_transaction_no,
            request_transaction_no: numbers.request_transaction_no,
          },
          diagresult_item: values.diagresult_item.map((row: Values) => ({
            ...row,
            result_transaction_no: numbers[`result_${row.diagnostic_code}`],
          })),
        },
      };
    }
    case "medicine": {
      const numbers = await issueNumbers(actor, draftId, stored, async () => ({
        case_no: parent.case_no,
        soap_transaction_no: parent.soap_transaction_no,
        meds_transaction_no: await issue(actor, "M"),
      }));
      return {
        pin,
        numbers,
        body: {
          ...values,
          medicine: values.medicine.map((row: Values) => ({ ...row, ...numbers })),
        },
      };
    }
    case "referral": {
      const numbers = await issueNumbers(actor, draftId, stored, async () => ({
        case_no: parent.case_no,
        soap_transaction_no: parent.soap_transaction_no,
        referral_transaction_no: await issue(actor, "R"),
      }));
      return {
        pin,
        numbers,
        body: {
          ...values,
          soap: {
            ...values.soap,
            case_no: numbers.case_no,
            soap_transaction_no: numbers.soap_transaction_no,
            pcu_transaction_code: content.parent?.pcuCode ?? "",
          },
          referral: {
            ...values.referral,
            referral_transaction_no: numbers.referral_transaction_no,
          },
        },
      };
    }
  }
}

export type SubmitInput = { draftId: string; values: Values; consent: boolean };

export async function submitDraft(
  actor: Actor,
  { draftId, values, consent }: SubmitInput,
): Promise<ActionResult<{ submissionId: string }>> {
  if (!consent) return fieldFailure({ consent: "Confirm the patient's consent first." });

  const draft = await loadDraft(actor, draftId);
  if (!draft) return { ok: false, title: "This draft no longer exists" };
  const { form, content } = draft;

  const checker = checkerFor(form);
  const editable = checker.check(values);
  if (editable.issues.length) return validationFailure(editable.issues);

  const filled = await fillForm(actor, form, draftId, content, values);
  if ("ok" in filled) return filled;

  const final = checker.check(
    { ...filled.body, consent: true },
    { accreNo: actor.accreNo, includeHidden: true },
  );
  if (final.issues.length) return validationFailure(final.issues);

  await recordConsent(actor, filled.pin, form);
  const logDetails = { patient_pin: filled.pin };
  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).upload(form, final.body);
    const payload: StoredPayload = {
      values,
      numbers: filled.numbers,
      pcuCode: filled.pcuCode,
      parent: content.parent,
    };
    const submissionId = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(submissions)
        .values({
          facilityId: actor.facilityId,
          submittedBy: actor.id,
          form,
          uploadTransactionNo: data.upload_transaction_no,
          processingStatus: data.processing_status,
          recordKey: filled.numbers[PRIMARY_NUMBER[form]],
          recordNumbers: filled.numbers,
          parentSubmissionId: content.parent?.submissionId,
          payloadEncrypted: encryptJson(payload),
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
    await logEntry(actor, `pcapi.upload.${form}`, logDetails, requestId);
    return { ok: true, data: { submissionId }, requestId };
  } catch (error) {
    await logEntry(
      actor,
      `pcapi.upload.${form}.failed`,
      { ...logDetails, issue: failureCode(error) },
      requestIdOf(error),
    );
    return toFailure(error);
  }
}

/** Opens a rejected submission for correction under the same record numbers. */
export async function correctSubmission(actor: Actor, submissionId: string) {
  const [row] = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.id, submissionId),
        eq(submissions.facilityId, actor.facilityId),
        eq(submissions.processingStatus, "rejected"),
        isNull(submissions.supersededAt),
      ),
    )
    .limit(1);
  if (!row) return null;

  const { values, numbers, parent } = decryptJson<StoredPayload>(row.payloadEncrypted);
  return {
    form: row.form,
    draftId: await createDraft(actor, row.form, pinOf(row.form, values), {
      values,
      step: 0,
      numbers,
      parent,
      correctsSubmissionId: row.id,
    }),
  };
}

export async function loadParent(actor: Actor, id: string, form: UploadForm) {
  const [row] = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.id, id),
        eq(submissions.facilityId, actor.facilityId),
        eq(submissions.form, form),
        eq(submissions.processingStatus, "accepted"),
      ),
    )
    .limit(1);
  return row ? { row, payload: decryptJson<StoredPayload>(row.payloadEncrypted) } : null;
}

export type UploadItem = {
  id: string;
  form: UploadForm;
  patient: string;
  status: "draft" | ProcessingStatus;
  uploadNo?: string;
  errors?: { field: string; issue: string }[];
  parentId?: string | null;
  flags?: { diagnostics: boolean; medicine: boolean; referral: boolean };
};

function describe(form: UploadForm, values: Values) {
  return FORM_DEFINITIONS[form].describePatient(values);
}

export async function listUploads(actor: Actor, forms: UploadForm[]): Promise<UploadItem[]> {
  const draftRows = await db
    .select()
    .from(drafts)
    .where(and(eq(drafts.facilityId, actor.facilityId), inArray(drafts.form, forms)))
    .orderBy(desc(drafts.updatedAt))
    .limit(100);
  const submissionRows = await db
    .select()
    .from(submissions)
    .where(
      and(
        eq(submissions.facilityId, actor.facilityId),
        inArray(submissions.form, forms),
        isNull(submissions.supersededAt),
      ),
    )
    .orderBy(desc(submissions.createdAt))
    .limit(200);

  return [
    ...draftRows.map((row): UploadItem => {
      const content = decryptJson<DraftContent>(row.payloadEncrypted);
      return {
        id: row.id,
        form: row.form,
        patient: describe(row.form, content.values),
        status: "draft",
        parentId: content.parent?.submissionId,
      };
    }),
    ...submissionRows.map((row): UploadItem => {
      const { values } = decryptJson<StoredPayload>(row.payloadEncrypted);
      const { management } = values;
      return {
        id: row.id,
        form: row.form,
        patient: describe(row.form, values),
        status: row.processingStatus,
        uploadNo: row.uploadTransactionNo ?? undefined,
        errors: row.errors as UploadItem["errors"],
        parentId: row.parentSubmissionId,
        ...(row.form === "consultation" && {
          flags: {
            diagnostics: management?.diagnostic_services_flag !== "N",
            medicine: management?.medication_prescription_flag === "Y",
            referral: management?.referral_flag === "Y",
          },
        }),
      };
    }),
  ];
}
