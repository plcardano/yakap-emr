// Development-only values. Nothing here is a real credential.

export const MOCK_CERT_ID = "SC-MOCK-0001";
export const MOCK_SECRET_KEY = "mock-secret-key";
export const MOCK_UNCERTIFIED_CERT_ID = "SC-MOCK-UNCERTIFIED";

/** Accreditation numbers linked to the mock certificate, with their cipher keys. */
export const MOCK_FACILITIES: Record<string, string> = {
  H12345678: "PCAPI-TEST-CIPHER-KEY-0001",
  H87654321: "PCAPI-TEST-CIPHER-KEY-0002",
  H11112222: "PCAPI-TEST-CIPHER-KEY-0003",
};

export const MOCK_VALID_OTP = "123456";

/** Patient PINs that trigger documented outcomes. Any other 12-digit PIN is a normal beneficiary. */
export const SCENARIO_PINS = {
  notFound: "000000000404",
  deceased: "000000000422",
  assignedElsewhere: "000000000555",
  transferred: "000000000666",
  cancelled: "000000000777",
} as const;

/** PhilHealth Check outcome, chosen by the last_name sent to /pcu/start. */
export const PCU_SCENARIOS: Record<string, { status: string; code: string; message: string }> = {
  TAGGED: { status: "success", code: "109", message: "Tagged deceased and updated to active" },
  DUPLICATE: { status: "duplicate", code: "106", message: "The profile requires further verification" },
  DECEASED: { status: "deceased", code: "107", message: "Deceased-related membership outcome" },
  NORECORD: { status: "norecord", code: "108", message: "No PhilHealth number found" },
  INVALID: { status: "invalid", code: "101", message: "PSA could not validate the identity" },
  PSAERROR: { status: "psaerror", code: "100", message: "PSA processing error" },
};

/** Validator name lookups, chosen by last_name. */
export const LOOKUP_NOT_FOUND = "NOTFOUND";
export const LOOKUP_MULTIPLE = "MULTIPLE";

/** A patient_lname that makes an upload fail after queueing. */
export const REJECT_UPLOAD_LNAME = "REJECT";
