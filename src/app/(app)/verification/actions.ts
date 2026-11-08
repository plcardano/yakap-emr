"use server";

import { requireUser } from "@/server/auth/session";
import {
  captureValidId,
  startPcuCheck,
  validateVerificationCode,
  verifyPcuCheck,
  type OtpInput,
  type PcuStartInput,
} from "@/server/verification/service";

export async function startPcuAction(input: PcuStartInput) {
  return startPcuCheck(await requireUser(), input);
}

export async function verifyPcuAction(authorizationId: string) {
  return verifyPcuCheck(await requireUser(), authorizationId);
}

export async function validateOtpAction(input: OtpInput) {
  return validateVerificationCode(await requireUser(), input);
}

export async function captureValidIdAction(form: FormData) {
  const actor = await requireUser();
  const file = form.get("image");
  return captureValidId(actor, {
    patient_pin: String(form.get("patient_pin") ?? ""),
    valid_id_type: String(form.get("valid_id_type") ?? ""),
    image: file instanceof File ? new Uint8Array(await file.arrayBuffer()) : new Uint8Array(),
    consent: form.get("consent") === "true",
  });
}
