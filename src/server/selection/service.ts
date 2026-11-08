import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { audit } from "@/server/audit/log";
import { hmacPin, encryptAtRest } from "@/server/crypto/at-rest";
import { db } from "@/server/db";
import { consentRecords } from "@/server/db/schema";
import { pcapiFor } from "@/server/pcapi";
import { manilaDate } from "@/server/pcapi/record-number-format";
import type { SelectionData } from "@/server/pcapi/services";
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
import type { Actor } from "@/server/verification/service";

const PIN = /^\d{12}$/;

export async function selectionEvidence(actor: Actor, pin: string) {
  return PIN.test(pin) ? availableEvidence(actor, pin) : [];
}

export type SelectionInput = {
  patient_pin: string;
  selection_date: string;
  mode: VerificationMode | "";
  consent: boolean;
};

function toIso(usDate: string) {
  const [month, day, year] = usDate.split("/");
  return `${year}-${month}-${day}`;
}

export async function submitSelection(
  actor: Actor,
  input: SelectionInput,
): Promise<ActionResult<SelectionData>> {
  const errors: Record<string, string> = {};
  if (!input.consent) errors.consent = "Confirm the patient's consent first.";
  if (!PIN.test(input.patient_pin)) {
    errors.patient_pin = "Enter exactly 12 digits, with no dashes or spaces.";
  }
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(input.selection_date)) {
    errors.selection_date = "Enter a valid date.";
  } else if (toIso(input.selection_date) > manilaDate()) {
    errors.selection_date = "The selection date cannot be in the future.";
  }
  if (!input.mode) errors.mode = "Choose how the patient was verified today.";
  if (Object.keys(errors).length) return fieldFailure(errors);

  const evidence = await evidenceFields(actor, input.patient_pin, input.mode as VerificationMode);
  if (!evidence) {
    return fieldFailure({ mode: "This verification was not completed today." });
  }

  await db.insert(consentRecords).values({
    facilityId: actor.facilityId,
    recordedBy: actor.id,
    patientPinHmac: hmacPin(input.patient_pin),
    subjectEncrypted: encryptAtRest(JSON.stringify({ patient_pin: input.patient_pin })),
    purpose: "selection",
  });

  const actorLog = { facilityId: actor.facilityId, userId: actor.id };
  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).selection({
      patient_pin: input.patient_pin,
      selection_date: input.selection_date,
      consent: true,
      ...evidence,
    });
    await audit({
      ...actorLog,
      action: "pcapi.selection",
      requestId,
      details: { patient_pin: input.patient_pin },
    });
    return { ok: true, data, requestId };
  } catch (error) {
    await audit({
      ...actorLog,
      action: "pcapi.selection.failed",
      requestId: requestIdOf(error),
      details: { patient_pin: input.patient_pin, issue: failureCode(error) },
    });
    return toFailure(error);
  }
}
