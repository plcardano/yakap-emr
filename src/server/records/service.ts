import "server-only";
import type { ActionResult } from "@/lib/action-result";
import { serializeRequest, validateRequest, type SpecId } from "@/lib/pcapi-spec";
import { audit } from "@/server/audit/log";
import { encryptAtRest, hmacPin } from "@/server/crypto/at-rest";
import { db } from "@/server/db";
import { consentRecords } from "@/server/db/schema";
import { pcapiFor } from "@/server/pcapi";
import type { MasterlistData } from "@/server/pcapi/services";
import {
  failureCode,
  fieldFailure,
  requestIdOf,
  toFailure,
  validationFailure,
} from "@/server/verification/failure";
import type { Actor } from "@/server/verification/service";

const CONSENT_MESSAGE = "Confirm the consent first.";
const MAX_RANGE_DAYS = 7;

function logEntry(
  actor: Actor,
  action: string,
  details: Record<string, unknown>,
  requestId?: string,
) {
  return audit({ facilityId: actor.facilityId, userId: actor.id, action, requestId, details });
}

function checkLocally(spec: SpecId, input: Record<string, unknown>) {
  const issues = validateRequest(spec, serializeRequest(spec, input));
  return issues.length ? validationFailure(issues) : null;
}

async function recordConsent(actor: Actor, subject: Record<string, unknown>, purpose: string) {
  const pin = typeof subject.patient_pin === "string" ? subject.patient_pin : "";
  await db.insert(consentRecords).values({
    facilityId: actor.facilityId,
    recordedBy: actor.id,
    patientPinHmac: pin ? hmacPin(pin) : null,
    subjectEncrypted: encryptAtRest(JSON.stringify(subject)),
    purpose,
  });
}

export type IndividualInput = { patient_pin: string; eff_year: string; consent: boolean };

export async function lookupAssignment(
  actor: Actor,
  input: IndividualInput,
): Promise<ActionResult<MasterlistData>> {
  if (!input.consent) return fieldFailure({ consent: CONSENT_MESSAGE });
  const invalid = checkLocally("masterlist_individual", input);
  if (invalid) return invalid;

  await recordConsent(actor, { patient_pin: input.patient_pin }, "masterlist_individual");
  const details = { patient_pin: input.patient_pin };
  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).masterlistIndividual(input);
    await logEntry(actor, "pcapi.masterlist_individual", details, requestId);
    return { ok: true, data, requestId };
  } catch (error) {
    await logEntry(
      actor,
      "pcapi.masterlist_individual.failed",
      { ...details, issue: failureCode(error) },
      requestIdOf(error),
    );
    return toFailure(error);
  }
}

export type BatchInput = { start_date: string; end_date: string; consent: boolean };

function utcDay(usDate: string) {
  const [month, day, year] = usDate.split("/").map(Number);
  return Date.UTC(year, month - 1, day);
}

export async function downloadBatch(
  actor: Actor,
  input: BatchInput,
): Promise<ActionResult<MasterlistData>> {
  if (!input.consent) return fieldFailure({ consent: CONSENT_MESSAGE });
  const invalid = checkLocally("masterlist_batch", input);
  if (invalid) return invalid;

  // 1 to 7 days, counting both dates (guide 4.5.2).
  const days = (utcDay(input.end_date) - utcDay(input.start_date)) / 86_400_000 + 1;
  if (days < 1) return fieldFailure({ end_date: "The end date cannot be before the start date." });
  if (days > MAX_RANGE_DAYS) return fieldFailure({ end_date: "The range can cover at most 7 days." });

  const range = { start_date: input.start_date, end_date: input.end_date };
  await recordConsent(actor, range, "masterlist_batch");
  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).masterlistBatch(input);
    await logEntry(
      actor,
      "pcapi.masterlist_batch",
      { ...range, total_records: data.total_records },
      requestId,
    );
    return { ok: true, data, requestId };
  } catch (error) {
    await logEntry(
      actor,
      "pcapi.masterlist_batch.failed",
      { ...range, issue: failureCode(error) },
      requestIdOf(error),
    );
    return toFailure(error);
  }
}

export type SlipInput = { patient_pin: string; eff_year: string; consent: boolean };

export async function fetchAvailmentSlip(
  actor: Actor,
  input: SlipInput,
): Promise<ActionResult<{ base64: string; fileName: string }>> {
  if (!input.consent) return fieldFailure({ consent: CONSENT_MESSAGE });
  const invalid = checkLocally("availment_slip", input);
  if (invalid) return invalid;

  await recordConsent(actor, { patient_pin: input.patient_pin }, "availment_slip");
  const details = { patient_pin: input.patient_pin, eff_year: input.eff_year };
  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).availmentSlip(input);
    await logEntry(actor, "pcapi.availment_slip", details, requestId);
    return {
      ok: true,
      requestId,
      data: {
        base64: data.toString("base64"),
        fileName: `availment_slip_${input.patient_pin}_${input.eff_year}.pdf`,
      },
    };
  } catch (error) {
    await logEntry(
      actor,
      "pcapi.availment_slip.failed",
      { ...details, issue: failureCode(error) },
      requestIdOf(error),
    );
    return toFailure(error);
  }
}
