import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { ActionResult } from "@/lib/action-result";
import { audit } from "@/server/audit/log";
import { encryptAtRest, hmacPin } from "@/server/crypto/at-rest";
import { db } from "@/server/db";
import { consentRecords, patientCases, submissions } from "@/server/db/schema";
import { pcapiFor } from "@/server/pcapi";
import type { ProcessingStatus, ValidatorData } from "@/server/pcapi/services";
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
} from "@/server/verification/failure";
import {
  lookupBeneficiary,
  type Actor as BaseActor,
  type LookupInput,
} from "@/server/verification/service";

type Actor = BaseActor & { username: string };

export type EmpanelmentTracker = {
  validator: ValidatorData;
  evidence: VerificationMode[];
  /** This facility's latest FPE upload, which the Validator shows only once accepted. */
  fpeUpload: ProcessingStatus | null;
  /** Set right after an agreement is recorded. */
  referenceNo?: string;
};

async function latestFpeUpload(actor: Actor, pin: string) {
  const [patientCase] = await db
    .select({ caseNo: patientCases.caseNo })
    .from(patientCases)
    .where(
      and(eq(patientCases.facilityId, actor.facilityId), eq(patientCases.patientPinHmac, hmacPin(pin))),
    )
    .limit(1);
  if (!patientCase) return null;

  const [latest] = await db
    .select({ status: submissions.processingStatus })
    .from(submissions)
    .where(
      and(
        eq(submissions.facilityId, actor.facilityId),
        eq(submissions.form, "fpe"),
        isNull(submissions.supersededAt),
        sql`${submissions.recordNumbers}->>'case_no' = ${patientCase.caseNo}`,
      ),
    )
    .orderBy(desc(submissions.createdAt))
    .limit(1);
  return latest?.status ?? null;
}

export async function loadTracker(
  actor: Actor,
  input: LookupInput,
): Promise<ActionResult<EmpanelmentTracker>> {
  const lookup = await lookupBeneficiary(actor, input);
  if (!lookup.ok) return lookup;

  const pin = lookup.data.patient_pin;
  return {
    ok: true,
    requestId: lookup.requestId,
    data: {
      validator: lookup.data,
      evidence: await availableEvidence(actor, pin),
      fpeUpload: await latestFpeUpload(actor, pin),
    },
  };
}

export type RecordEmpanelmentInput = {
  patient_pin: string;
  mode: VerificationMode | "";
  consent: boolean;
};

export async function recordEmpanelment(
  actor: Actor,
  { patient_pin, mode, consent }: RecordEmpanelmentInput,
): Promise<ActionResult<EmpanelmentTracker>> {
  const errors: Record<string, string> = {};
  if (!consent) errors.consent = "Confirm the patient's consent first.";
  if (!mode) errors.mode = "Choose how the patient was verified today.";
  if (Object.keys(errors).length) return fieldFailure(errors);

  // Evidence is limited to today, as the guide requires (4.3).
  const evidence = await evidenceFields(actor, patient_pin, mode as VerificationMode);
  if (!evidence) return fieldFailure({ mode: "This verification was not completed today." });

  await db.insert(consentRecords).values({
    facilityId: actor.facilityId,
    recordedBy: actor.id,
    patientPinHmac: hmacPin(patient_pin),
    subjectEncrypted: encryptAtRest(JSON.stringify({ patient_pin })),
    purpose: "empanelment",
  });

  const logActor = { facilityId: actor.facilityId, userId: actor.id };
  let referenceNo: string;
  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).empanelment({
      patient_pin,
      consent: true,
      created_by: actor.username,
      ...evidence,
    });
    referenceNo = data.yes_reference_no;
    await audit({
      ...logActor,
      action: "pcapi.empanelment",
      requestId,
      details: { patient_pin, yes_reference_no: referenceNo },
    });
  } catch (error) {
    await audit({
      ...logActor,
      action: "pcapi.empanelment.failed",
      requestId: requestIdOf(error),
      details: { patient_pin, issue: failureCode(error) },
    });
    return toFailure(error);
  }

  // The agreement is recorded. Its status is read back through the Validator (guide 4.3).
  const tracker = await loadTracker(actor, {
    patient_pin,
    eff_year: "",
    first_name: "",
    last_name: "",
    middle_name: "",
    patient_dob: "",
    consent: true,
  });
  if (!tracker.ok) return tracker;
  return { ok: true, data: { ...tracker.data, referenceNo } };
}
