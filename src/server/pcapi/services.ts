import {
  serializeRequest,
  validateRequest,
  type SpecId,
  type UploadForm,
} from "@/lib/pcapi-spec";
import type { PcapiClient } from "./client";
import { PcapiValidationError } from "./errors";

type Input = Record<string, unknown>;

export type ProcessingStatus = "queued" | "processing" | "accepted" | "rejected";

export type PcuStartData = {
  authorization_id: string;
  launch_token: string;
  launch_url: string;
  sdk_url: string;
  expires_at: string;
};

export type PcuVerifyData = {
  request_id: string;
  status: string;
  message: string;
  result_code: string;
  trans_no: string;
  verified: string;
  pin_matched?: "Y" | "N";
  member?: { pin: string; type: string; sex: string };
  konsulta?: {
    searched: boolean;
    available: boolean;
    assigned: "YES" | "NO" | null;
    hci_name: string;
    date_assigned: string;
    message: string;
  };
};

/** Fields with no value are omitted by the Validator (guide 4.2). */
export type ValidatorData = {
  patient_pin: string;
  accre_no: string;
  eff_year: string;
  message?: string;
  patient_lname?: string;
  patient_fname?: string;
  patient_mname?: string;
  patient_extname?: string;
  patient_dob?: string;
  pcu: {
    status: "VERIFIED" | "FAILED" | "UNVERIFIED";
    latest_date?: string;
    transaction_no?: string;
  };
  selection: {
    status: "ASSIGNED" | "TRANSFERRED" | "CANCELLED" | "NOT_ASSIGNED";
    transaction_no?: string;
    date?: string;
  };
  fpe: StageStatus & { upload_transaction_no?: string };
  empanelment: StageStatus;
  consultation: StageStatus & { upload_transaction_no?: string };
};

type StageStatus = { status: "Y" | "N"; date?: string; transaction_no?: string };

export type EmpanelmentData = {
  yes_reference_no: string;
  patient_pin: string;
  accre_no: string;
  eff_year: string;
  with_yes: boolean;
  with_fpe: boolean;
  fpe_transaction_no: string;
  pcu_transaction_code: string;
};

export type SelectionData = {
  patient_pin: string;
  accre_no: string;
  selection: { status: "ASSIGNED"; transaction_no: string; date: string };
};

export type MasterlistAssignment = {
  patient_pin: string;
  patient_lname: string;
  patient_fname: string;
  patient_mname: string;
  patient_extname: string;
  patient_dob: string;
  patient_sex: string;
  patient_type: "MM" | "DD";
  member_pin: string;
  member_lname: string;
  member_fname: string;
  member_mname: string;
  member_extname: string;
  member_dob: string;
  member_sex: string;
  patient_mobile_no: string;
  patient_landline_no: string;
  member_category: string;
  member_category_desc: string;
  package_type: string;
  assignment_date: string;
  assignment_status: "1" | "2" | "3";
  eff_year: string;
};

export type MasterlistData = {
  accre_no: string;
  transmittal_no: string;
  eff_year?: string;
  start_date?: string;
  end_date?: string;
  total_records: number;
  assignments: MasterlistAssignment[];
};

export type UploadData = {
  upload_transaction_no: string;
  form: UploadForm;
  processing_status: ProcessingStatus;
  [recordNumber: string]: unknown;
};

export type UploadStatusData = UploadData & {
  received_at: string;
  processed_at?: string;
  errors: { field: string; issue: string }[];
};

export type VerificationCodeData = {
  patient_pin: string;
  accre_no: string;
  transaction_date: string;
  status: "VALID";
};

const UPLOAD_PATHS: Record<UploadForm, string> = {
  fpe: "fpe",
  consultation: "consultation",
  diagnostic_request: "diagnostic-request",
  diagnostic_results: "diagnostic-results",
  medicine: "medicine",
  referral: "referral",
};

/** The PCAPI services for one facility, the accre_no in the bearer token. */
export function pcapiServices(client: PcapiClient, accreNo: string) {
  function prepare(spec: SpecId, input: Input) {
    const body = serializeRequest(spec, input);
    const issues = validateRequest(spec, body, { accreNo });
    if (issues.length > 0) throw new PcapiValidationError(issues);
    return body;
  }

  // retry = false wherever a repeat could give a misleading result (guide 4.1, 4.3, 4.4).
  async function post<T>(spec: SpecId, path: string, input: Input, retry: boolean) {
    return client.callJson<T>({
      accreNo,
      method: "POST",
      path,
      body: prepare(spec, input),
      retry,
    });
  }

  return {
    pcuStart: (input: Input) =>
      post<PcuStartData>("pcu_start", "/api/v1/pcu/start", input, false),
    pcuVerify: (livenessAuthorizationId: string) =>
      post<PcuVerifyData>(
        "pcu_verify",
        "/api/v1/pcu/verify",
        { liveness_authorization_id: livenessAuthorizationId },
        false,
      ),
    validator: (input: Input) =>
      post<ValidatorData>("validator", "/api/v1/philhealth-yakap-validator", input, true),
    empanelment: (input: Input) =>
      post<EmpanelmentData>("empanelment", "/api/v1/yakap-empanelment", input, false),
    selection: (input: Input) =>
      post<SelectionData>("selection", "/api/v1/yakap-selection", input, false),
    masterlistIndividual: (input: Input) =>
      post<MasterlistData>(
        "masterlist_individual",
        "/api/v1/yakap-selection-masterlist/individual",
        input,
        true,
      ),
    masterlistBatch: (input: Input) =>
      post<MasterlistData>(
        "masterlist_batch",
        "/api/v1/yakap-selection-masterlist/batch",
        input,
        true,
      ),
    // An identical resend returns the original submission, so retries are safe (guide 4.6).
    upload: (form: UploadForm, input: Input) =>
      post<UploadData>(form, `/api/v1/yakap-data-upload/${UPLOAD_PATHS[form]}`, input, true),
    uploadStatus: (uploadTransactionNo: string) =>
      client.callJson<UploadStatusData>({
        accreNo,
        method: "GET",
        path: `/api/v1/yakap-data-upload/status/${encodeURIComponent(uploadTransactionNo)}`,
        retry: true,
      }),
    verificationCode: (input: Input) =>
      post<VerificationCodeData>(
        "verification_code",
        "/api/v1/yakap-patient-verification-code",
        input,
        true,
      ),
    availmentSlip: async (input: Input) =>
      client.callBytes({
        accreNo,
        method: "POST",
        path: "/api/v1/yakap-availment-slip",
        body: prepare("availment_slip", input),
        retry: true,
      }),
  };
}

export type PcapiServices = ReturnType<typeof pcapiServices>;
