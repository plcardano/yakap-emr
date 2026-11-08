import type { VerificationMode } from "@/server/verification/evidence";

export const MODE_LABELS: Record<VerificationMode, string> = {
  PCU: "PhilHealth Check",
  OTP: "Verification code",
  VALID_ID: "Valid ID",
};
