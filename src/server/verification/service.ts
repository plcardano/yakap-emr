import "server-only";
import { and, eq } from "drizzle-orm";
import type { ActionResult } from "@/lib/action-result";
import {
  libraries,
  serializeRequest,
  validateRequest,
  type SpecId,
} from "@/lib/pcapi-spec";
import { pcuOutcome, type PcuOutcome } from "@/lib/pcapi-messages";
import { audit } from "@/server/audit/log";
import { encryptAtRest, hmacPin } from "@/server/crypto/at-rest";
import { db } from "@/server/db";
import { consentRecords, patientVerifications } from "@/server/db/schema";
import { pcapiFor } from "@/server/pcapi";
import { PcapiNetworkError } from "@/server/pcapi/errors";
import { manilaDate } from "@/server/pcapi/record-number-format";
import type {
  PcuStartData,
  PcuVerifyData,
  ValidatorData,
} from "@/server/pcapi/services";
import {
  failureCode,
  fieldFailure,
  requestIdOf,
  toFailure,
  validationFailure,
} from "./failure";

export type Actor = {
  id: string;
  facilityId: string;
  accreNo: string;
};

const CONSENT_MESSAGE = "Confirm the patient's consent first.";
const MAX_ID_IMAGE_BYTES = 2 * 1024 * 1024;

function pinHmac(pin: string) {
  return pin ? hmacPin(pin) : null;
}

async function recordConsent(actor: Actor, subject: Record<string, unknown>, purpose: string) {
  const pin = typeof subject.patient_pin === "string" ? subject.patient_pin : "";
  await db.insert(consentRecords).values({
    facilityId: actor.facilityId,
    recordedBy: actor.id,
    patientPinHmac: pinHmac(pin),
    subjectEncrypted: encryptAtRest(JSON.stringify(subject)),
    purpose,
  });
}

function checkLocally(spec: SpecId, input: Record<string, unknown>) {
  const issues = validateRequest(spec, serializeRequest(spec, input));
  return issues.length ? validationFailure(issues) : null;
}

function logSuccess(actor: Actor, action: string, requestId: string | undefined, details = {}) {
  return audit({
    action,
    facilityId: actor.facilityId,
    userId: actor.id,
    requestId,
    details,
  });
}

function logFailure(actor: Actor, action: string, error: unknown, details = {}) {
  return audit({
    action: `${action}.failed`,
    facilityId: actor.facilityId,
    userId: actor.id,
    requestId: requestIdOf(error),
    details: { ...details, issue: failureCode(error) },
  });
}

export type LookupInput = {
  patient_pin: string;
  eff_year: string;
  first_name: string;
  last_name: string;
  middle_name: string;
  patient_dob: string;
  consent: boolean;
};

export async function lookupBeneficiary(
  actor: Actor,
  input: LookupInput,
): Promise<ActionResult<ValidatorData>> {
  if (!input.consent) return fieldFailure({ consent: CONSENT_MESSAGE });

  // Either the PIN or the full name and birth date (guide 4.2).
  if (!input.patient_pin) {
    const missing = (["first_name", "last_name", "patient_dob"] as const).filter(
      (field) => !input[field],
    );
    if (missing.length) {
      return fieldFailure({
        patient_pin: "Enter the PIN, or the first name, last name and date of birth.",
        ...Object.fromEntries(missing.map((field) => [field, "This field is required."])),
      });
    }
  }

  const invalid = checkLocally("validator", input);
  if (invalid) return invalid;

  await recordConsent(actor, input, "validator");
  try {
    const result = await pcapiFor(actor.accreNo).validator(input);
    await logSuccess(actor, "pcapi.validator", result.requestId, {
      patient_pin: result.data.patient_pin,
    });
    return { ok: true, data: result.data, requestId: result.requestId };
  } catch (error) {
    await logFailure(actor, "pcapi.validator", error, { patient_pin: input.patient_pin });
    return toFailure(error);
  }
}

export type PcuStartInput = {
  pin: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  suffix: string;
  birth_date: string;
  consent: boolean;
};

export async function startPcuCheck(
  actor: Actor,
  { consent, ...details }: PcuStartInput,
): Promise<ActionResult<PcuStartData>> {
  if (!consent) return fieldFailure({ consent: CONSENT_MESSAGE });

  const invalid = checkLocally("pcu_start", details);
  if (invalid) return invalid;

  // PCU has no consent field, so the record here is the only attestation (guide 3.5).
  await recordConsent(actor, { ...details, patient_pin: details.pin }, "philhealth_check");
  try {
    const result = await pcapiFor(actor.accreNo).pcuStart(details);
    // Guide 3.6: the LIVENESS host is also reached over HTTPS only.
    if (process.env.NODE_ENV === "production" && !result.data.sdk_url.startsWith("https://")) {
      throw new PcapiNetworkError("The LIVENESS address is not HTTPS");
    }
    await db.insert(patientVerifications).values({
      facilityId: actor.facilityId,
      createdBy: actor.id,
      mode: "PCU",
      status: "pending",
      patientPinHmac: pinHmac(details.pin),
      verificationDate: manilaDate(),
      livenessAuthorizationId: result.data.authorization_id,
      requestId: result.requestId,
    });
    await logSuccess(actor, "pcapi.pcu_start", result.requestId, { pin: details.pin });
    return { ok: true, data: result.data, requestId: result.requestId };
  } catch (error) {
    await logFailure(actor, "pcapi.pcu_start", error, { pin: details.pin });
    return toFailure(error);
  }
}

export type PcuResult = PcuVerifyData & { outcome: PcuOutcome };

export async function verifyPcuCheck(
  actor: Actor,
  authorizationId: string,
): Promise<ActionResult<PcuResult>> {
  // Claim the attempt first: an authorization permits only one verification (guide 4.1).
  const whereAttempt = and(
    eq(patientVerifications.livenessAuthorizationId, authorizationId),
    eq(patientVerifications.facilityId, actor.facilityId),
  );
  const [attempt] = await db
    .update(patientVerifications)
    .set({ status: "submitted" })
    .where(and(whereAttempt, eq(patientVerifications.status, "pending")))
    .returning({ id: patientVerifications.id });

  if (!attempt) {
    return {
      ok: false,
      title: "This check can no longer be used",
      body: "It may have expired or already been used. Start a new check.",
    };
  }

  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).pcuVerify(authorizationId);
    const outcome = pcuOutcome(data.result_code);
    await db
      .update(patientVerifications)
      .set({
        status: outcome.verified ? "verified" : "failed",
        resultCode: data.result_code,
        pcuTransNo: data.trans_no,
        patientPinHmac: data.member?.pin ? hmacPin(data.member.pin) : undefined,
        requestId,
      })
      .where(eq(patientVerifications.id, attempt.id));
    await logSuccess(actor, "pcapi.pcu_verify", requestId, {
      pin: data.member?.pin,
      result_code: data.result_code,
    });
    return { ok: true, data: { ...data, outcome }, requestId };
  } catch (error) {
    await db
      .update(patientVerifications)
      .set({ status: "error", requestId: requestIdOf(error) })
      .where(eq(patientVerifications.id, attempt.id));
    await logFailure(actor, "pcapi.pcu_verify", error);
    return toFailure(error);
  }
}

export type OtpInput = {
  patient_pin: string;
  one_time_pin: string;
  transaction_date: string;
  consent: boolean;
};

export async function validateVerificationCode(
  actor: Actor,
  input: OtpInput,
): Promise<ActionResult<{ transaction_date: string }>> {
  if (!input.consent) return fieldFailure({ consent: CONSENT_MESSAGE });

  const invalid = checkLocally("verification_code", input);
  if (invalid) return invalid;

  const { one_time_pin, ...subject } = input;
  await recordConsent(actor, subject, "verification_code");
  try {
    const { data, requestId } = await pcapiFor(actor.accreNo).verificationCode(input);
    await db.insert(patientVerifications).values({
      facilityId: actor.facilityId,
      createdBy: actor.id,
      mode: "OTP",
      status: "verified",
      patientPinHmac: hmacPin(input.patient_pin),
      verificationDate: manilaDate(),
      oneTimePinEncrypted: encryptAtRest(one_time_pin),
      requestId,
    });
    await logSuccess(actor, "pcapi.verification_code", requestId, {
      patient_pin: input.patient_pin,
    });
    return { ok: true, data: { transaction_date: data.transaction_date }, requestId };
  } catch (error) {
    await logFailure(actor, "pcapi.verification_code", error, {
      patient_pin: input.patient_pin,
    });
    return toFailure(error);
  }
}

function isJpeg(bytes: Uint8Array) {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

export type ValidIdInput = {
  patient_pin: string;
  valid_id_type: string;
  image: Uint8Array;
  consent: boolean;
};

/** Valid ID has no PCAPI call of its own. It is sent with Selection, FPE and Empanelment. */
export async function captureValidId(
  actor: Actor,
  input: ValidIdInput,
): Promise<ActionResult<{ valid_id_type: string }>> {
  if (!input.consent) return fieldFailure({ consent: CONSENT_MESSAGE });

  const fieldErrors: Record<string, string> = {};
  if (!/^\d{12}$/.test(input.patient_pin)) {
    fieldErrors.patient_pin = "Enter exactly 12 digits, with no dashes or spaces.";
  }
  if (!libraries["Valid ID Type"].some((entry) => entry.code === input.valid_id_type)) {
    fieldErrors.valid_id_type = "Choose a value from the list.";
  }
  if (!isJpeg(input.image)) {
    fieldErrors.valid_id_image = "Upload a JPEG image.";
  } else if (input.image.length > MAX_ID_IMAGE_BYTES) {
    fieldErrors.valid_id_image = "The image must be 2 MB or smaller.";
  }
  if (Object.keys(fieldErrors).length) return fieldFailure(fieldErrors);

  await recordConsent(actor, { patient_pin: input.patient_pin }, "valid_id");
  await db.insert(patientVerifications).values({
    facilityId: actor.facilityId,
    createdBy: actor.id,
    mode: "VALID_ID",
    status: "captured",
    patientPinHmac: hmacPin(input.patient_pin),
    verificationDate: manilaDate(),
    validIdType: input.valid_id_type,
    validIdImageEncrypted: encryptAtRest(Buffer.from(input.image).toString("base64")),
  });
  await logSuccess(actor, "valid_id.captured", undefined, {
    patient_pin: input.patient_pin,
    valid_id_type: input.valid_id_type,
  });
  return { ok: true, data: { valid_id_type: input.valid_id_type } };
}
