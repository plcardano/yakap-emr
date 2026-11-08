export type Condition = {
  field: string;
  op: "eq" | "includes";
  values: string[];
};

export type DateFormat = "MM/DD/YYYY" | "MM/YYYY" | "YYYY" | "HH:MM";

/** One row of the Data Dictionary "Validation Rules" worksheet, in structured form. */
export type FieldRule = {
  path: string;
  type: "string" | "number" | "boolean";
  required: "yes" | "no" | "conditional";
  maxBytes?: number;
  maxChars?: number;
  exactChars?: number;
  digits?: number;
  dateFormat?: DateFormat;
  decimals?: number;
  min?: number;
  max?: number;
  whole?: boolean;
  yesNo?: boolean;
  allergy?: boolean;
  mustBeTrue?: boolean;
  jpegMaxMb?: number;
  recordPrefix?: string;
  library?: string;
  /** Several library codes, separated by a comma. */
  multiple?: boolean;
  external?: string;
  notWith?: string;
  /** May be left out as well as sent as "". */
  mayOmit?: boolean;
  /** Parsed "Required if" clauses; all must hold. */
  when?: Condition[];
  /** The field must be left out when its condition does not hold. */
  absentWhenInactive?: boolean;
  /** A conditional rule that needs form-level logic, kept as its original text. */
  manual?: string;
};

export type FieldLabel = { label: string; unit?: string };

export type LibraryCode = { code: string; description: string };

export type SpecId =
  | "token"
  | "pcu_start"
  | "pcu_verify"
  | "validator"
  | "empanelment"
  | "selection"
  | "masterlist_individual"
  | "masterlist_batch"
  | "verification_code"
  | "availment_slip"
  | UploadForm;

export type UploadForm =
  | "fpe"
  | "consultation"
  | "diagnostic_request"
  | "diagnostic_results"
  | "medicine"
  | "referral";

export type ValidationIssue = {
  /** JSON path in the guide's format, for example medicine[0].drug_code. */
  field: string;
  issue: "validation_error";
  /** Why the check failed, for developers and tests. */
  reason: string;
};
