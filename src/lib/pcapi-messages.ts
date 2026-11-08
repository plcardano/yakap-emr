// Wording for staff, keyed by the codes PCAPI returns. Never derived from `message`.

type Copy = { title: string; body?: string };

const SUPPORT = "Contact PhilHealth support and quote the request ID.";
const NEW_CHECK = "Start a new check.";

export const ISSUE_COPY: Record<string, Copy> = {
  // Common
  validation_error: { title: "Some details need correcting", body: "Fix the fields below and try again." },
  decryption_failed: { title: "PhilHealth could not read this request", body: SUPPORT },
  hash_mismatch: { title: "PhilHealth could not read this request", body: SUPPORT },
  unauthorized: { title: "The connection to PhilHealth was refused", body: "Try again. If this continues, contact your administrator." },
  consent_required: { title: "Patient consent is required", body: "Record the patient's consent, then try again." },
  internal_error: { title: "PhilHealth had a problem with this request", body: SUPPORT },
  // Token
  invalid_credentials: { title: "The connection to PhilHealth was refused", body: "The system's PhilHealth credentials were not accepted. Contact your administrator." },
  software_not_certified: { title: "This software is not certified by PhilHealth", body: "Contact your administrator." },
  facility_not_linked: { title: "This facility is not linked to this software", body: "Contact your administrator." },
  // Lookup
  beneficiary_not_found: { title: "No beneficiary found", body: "Check the PIN, or the name and date of birth." },
  beneficiary_deceased: { title: "The beneficiary is recorded as deceased", body: "This request cannot be completed." },
  multiple_matches: { title: "More than one beneficiary matches", body: "Search by PIN, or add the middle name." },
  // PhilHealth Check
  invalid_request: { title: "PhilHealth could not read this request", body: SUPPORT },
  invalid_launch: { title: "The face capture could not start", body: NEW_CHECK },
  invalid_liveness_authorization: { title: "This check can no longer be used", body: `It may have expired or already been used. ${NEW_CHECK}` },
  rate_limit_exceeded: { title: "Too many checks right now", body: "Wait a few minutes, then start a new check." },
  configuration_error: { title: "PhilHealth Check is not configured correctly", body: SUPPORT },
  upstream_unavailable: { title: "PhilHealth Check is unavailable", body: "Wait a while, then start a new check." },
  upstream_error: { title: "The identity service returned an error", body: "Wait a while, then start a new check." },
  invalid_upstream_response: { title: "The identity service returned an unexpected response", body: SUPPORT },
  service_unavailable: { title: "PhilHealth Check is unavailable", body: "Contact PhilHealth support." },
  gateway_timeout: { title: "PhilHealth Check took too long to respond", body: NEW_CHECK },
  // Verification code
  code_invalid: { title: "The verification code is not valid", body: "Ask the patient for the current code. Do not retry the same code." },
  code_not_found: { title: "No verification code exists for this PIN" },
};

export const FALLBACK_COPY: Copy = {
  title: "The request could not be completed",
  body: SUPPORT,
};

export const REASON_COPY: Record<string, string> = {
  required: "This field is required.",
  must_be_present: "This field is required.",
  too_long: "This is too long.",
  wrong_length: "This has the wrong length.",
  wrong_digits: "Enter exactly 12 digits, with no dashes or spaces.",
  bad_date_format: "Enter a valid date.",
  unknown_library_code: "Choose a value from the list.",
  must_be_true: "This must be confirmed.",
  not_jpeg: "Upload a JPEG image.",
  image_too_large: "The image must be 2 MB or smaller.",
};

export const FALLBACK_REASON = "Check this value.";

export type PcuOutcome = { verified: boolean; title: string; body: string };

/** Guide Annex B. Only 105 and 109 count as verified. */
export function pcuOutcome(resultCode: string): PcuOutcome {
  switch (resultCode) {
    case "105":
      return { verified: true, title: "Patient verified", body: "A PhilHealth number was found." };
    case "109":
      return {
        verified: true,
        title: "Patient verified",
        body: "The member was tagged deceased and is now active because of this liveness check.",
      };
    case "106":
      return { verified: false, title: "Further verification needed", body: "The profile requires further verification." };
    case "107":
      return { verified: false, title: "Not verified", body: "The membership record has a deceased-related status." };
    case "108":
      return { verified: false, title: "No PhilHealth number found", body: "No PhilHealth number was found for these details." };
    case "100":
      return { verified: false, title: "Not verified", body: "The identity service had a processing error. Start a new check." };
    case "101":
    case "102":
      return { verified: false, title: "Not verified", body: "The identity or liveness details could not be validated. Check the details and start a new check." };
    case "104":
      return { verified: false, title: "Not verified", body: "The liveness session had an error. Start a new check." };
    default:
      return { verified: false, title: "Not verified", body: "This check did not verify the patient." };
  }
}
