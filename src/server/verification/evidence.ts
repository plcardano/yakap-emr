import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { decryptAtRest, hmacPin } from "@/server/crypto/at-rest";
import { db } from "@/server/db";
import { patientVerifications } from "@/server/db/schema";
import { manilaDate } from "@/server/pcapi/record-number-format";
import type { Actor } from "./service";

export type VerificationMode = "PCU" | "OTP" | "VALID_ID";

const USABLE_STATUS = { PCU: "verified", OTP: "verified", VALID_ID: "captured" } as const;

async function latestToday(actor: Actor, pin: string, mode: VerificationMode) {
  const [row] = await db
    .select()
    .from(patientVerifications)
    .where(
      and(
        eq(patientVerifications.facilityId, actor.facilityId),
        eq(patientVerifications.patientPinHmac, hmacPin(pin)),
        eq(patientVerifications.verificationDate, manilaDate()),
        eq(patientVerifications.mode, mode),
        eq(patientVerifications.status, USABLE_STATUS[mode]),
      ),
    )
    .orderBy(desc(patientVerifications.createdAt))
    .limit(1);
  return row;
}

/** Which verification modes this patient completed today, with no secrets. */
export async function availableEvidence(actor: Actor, pin: string) {
  const modes: VerificationMode[] = ["PCU", "OTP", "VALID_ID"];
  const rows = await Promise.all(modes.map((mode) => latestToday(actor, pin, mode)));
  return modes.filter((_, index) => rows[index]);
}

/** The request fields for a mode (guide 3.10), or null if it was not completed today. */
export async function evidenceFields(actor: Actor, pin: string, mode: VerificationMode) {
  const row = await latestToday(actor, pin, mode);
  if (!row) return null;
  return {
    patient_verification_mode: mode,
    pcu_transaction_code: mode === "PCU" ? (row.pcuTransNo ?? "") : "",
    one_time_pin: mode === "OTP" ? decryptAtRest(row.oneTimePinEncrypted ?? "") : "",
    valid_id_type: mode === "VALID_ID" ? (row.validIdType ?? "") : "",
    valid_id_image: mode === "VALID_ID" ? decryptAtRest(row.validIdImageEncrypted ?? "") : "",
  };
}
