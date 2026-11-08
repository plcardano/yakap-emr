// A local stand-in for PCAPI, built from Implementation Guide rev20261026.
// It uses the real Annex C encryption and the Data Dictionary checks.

import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { libraries, validateRequest, type SpecId, type UploadForm } from "../../src/lib/pcapi-spec";
import {
  decryptEnvelope,
  encryptEnvelope,
  EnvelopeError,
} from "../../src/server/pcapi/envelope";
import { ageText, computeBmi } from "../../src/lib/fpe/derived";
import {
  LOOKUP_MULTIPLE,
  LOOKUP_NOT_FOUND,
  MOCK_CERT_ID,
  MOCK_FACILITIES,
  MOCK_SECRET_KEY,
  MOCK_UNCERTIFIED_CERT_ID,
  MOCK_VALID_OTP,
  PCU_SCENARIOS,
  REJECT_UPLOAD_LNAME,
  SCENARIO_PINS,
} from "./config";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Issue = { field: string; issue: string };

const BASE = "/primary-care/api/v1";

function buildSamplePdf() {
  const content = "BT /F1 18 Tf 72 720 Td (Mock YAKAP Availment Slip) Tj ET";
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Count 1/Kids[3 0 R]>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${content.length}>>stream\n${content}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((body, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

const PDF = buildSamplePdf();
const LIVENESS_TTL_MS = 5 * 60 * 1000;

class Reject extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly issues: Issue[],
  ) {
    super(message);
  }
}

const reject = (status: number, message: string, field: string, issue: string) =>
  new Reject(status, message, [{ field, issue }]);

/** Current time in Philippine Standard Time, as YYYY-MM-DDTHH:MM:SS. */
function pst(offsetMs = 0) {
  return new Date(Date.now() + offsetMs + 8 * 3600 * 1000).toISOString().slice(0, 19);
}

function toUsDate(iso: string) {
  const [year, month, day] = iso.split("-");
  return `${month}/${day}/${year}`;
}

const today = () => toUsDate(pst().slice(0, 10));
const currentYear = () => pst().slice(0, 4);

function usDateValue(date: string) {
  const [month, day, year] = date.split("/").map(Number);
  return Date.UTC(year, month - 1, day);
}

function compact(accreNo: string, prefix: string, series: number) {
  return `${prefix}${accreNo}${pst().slice(0, 10).replaceAll("-", "")}${String(series).padStart(5, "0")}`;
}

function hashOf(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

type Upload = {
  uploadNo: string;
  form: UploadForm;
  accreNo: string;
  body: Json;
  recordKey: string;
  contentHash: string;
  echo: Json;
  status: "queued" | "processing" | "accepted" | "rejected";
  receivedAt: string;
  processedAt?: string;
  errors: Issue[];
};

type Selection = { accreNo: string; status: string; transactionNo: string; date: string };

const UPLOAD_ROUTES: Record<string, UploadForm> = {
  fpe: "fpe",
  consultation: "consultation",
  "diagnostic-request": "diagnostic_request",
  "diagnostic-results": "diagnostic_results",
  medicine: "medicine",
  referral: "referral",
};

function uploadRecord(form: UploadForm, body: Json) {
  switch (form) {
    case "fpe":
      return {
        key: body.profile.profile_transaction_no,
        echo: {
          case_no: body.enlistment.case_no,
          profile_transaction_no: body.profile.profile_transaction_no,
        },
      };
    case "consultation":
      return {
        key: body.soap.soap_transaction_no,
        echo: { case_no: body.soap.case_no, soap_transaction_no: body.soap.soap_transaction_no },
      };
    case "diagnostic_request": {
      const first = body.diagrequest[0];
      return {
        key: first.request_transaction_no,
        echo: {
          case_no: first.case_no,
          soap_transaction_no: first.soap_transaction_no,
          request_transaction_no: first.request_transaction_no,
        },
      };
    }
    case "diagnostic_results": {
      const head = body.diagnosticresult;
      const results = body.diagresult_item.map((item: Json) => item.result_transaction_no);
      return {
        key: results.join(","),
        echo: {
          case_no: head.case_no,
          soap_transaction_no: head.soap_transaction_no,
          request_transaction_no: head.request_transaction_no,
          result_transaction_no: results,
        },
      };
    }
    case "medicine": {
      const first = body.medicine[0];
      return {
        key: first.meds_transaction_no,
        echo: {
          case_no: first.case_no,
          soap_transaction_no: first.soap_transaction_no,
          meds_transaction_no: first.meds_transaction_no,
        },
      };
    }
    case "referral":
      return {
        key: body.referral.referral_transaction_no,
        echo: {
          case_no: body.soap.case_no,
          soap_transaction_no: body.soap.soap_transaction_no,
          referral_transaction_no: body.referral.referral_transaction_no,
        },
      };
  }
}

export type MockOptions = {
  /** How long an upload stays queued. */
  processDelayMs?: number;
};

export function createMockPcapi({ processDelayMs = 1500 }: MockOptions = {}) {
  const tokens = new Map<string, { accreNo: string; expiresAt: number }>();
  const liveness = new Map<string, Json>();
  const pcuRecords = new Map<string, Json>();
  const latestPcu = new Map<string, Json>();
  const selections = new Map<string, Selection>([
    [
      SCENARIO_PINS.assignedElsewhere,
      { accreNo: "H00000001", status: "ASSIGNED", transactionNo: "K", date: "01/01/2026" },
    ],
    [
      SCENARIO_PINS.transferred,
      { accreNo: "H00000001", status: "TRANSFERRED", transactionNo: "K", date: "01/01/2026" },
    ],
    [
      SCENARIO_PINS.cancelled,
      { accreNo: "H00000001", status: "CANCELLED", transactionNo: "K", date: "01/01/2026" },
    ],
  ]);
  const empanelments = new Map<string, Json>();
  const validIdSeen = new Set<string>();
  const uploads: Upload[] = [];
  const counters = new Map<string, number>();

  // Starts at a random point so numbers do not repeat when the mock restarts.
  const seriesStart = randomInt(1, 90000);

  function nextSeries(accreNo: string, prefix: string) {
    const key = `${accreNo}:${prefix}:${pst().slice(0, 10)}`;
    const value = (counters.get(key) ?? seriesStart) + 1;
    counters.set(key, value);
    return compact(accreNo, prefix, value);
  }

  function requireBeneficiary(pin: string) {
    if (pin === SCENARIO_PINS.notFound) {
      throw reject(404, "Beneficiary not found", "patient_pin", "beneficiary_not_found");
    }
    if (pin === SCENARIO_PINS.deceased) {
      throw reject(422, "The beneficiary is recorded as deceased", "patient_pin", "beneficiary_deceased");
    }
  }

  function checkVerification(body: Json, accreNo: string) {
    const pin = body.patient_pin;
    switch (body.patient_verification_mode) {
      case "PCU": {
        const record = pcuRecords.get(body.pcu_transaction_code);
        const field = "pcu_transaction_code";
        if (!record) throw reject(404, "PCU transaction not found", field, "pcu_transaction_not_found");
        if (record.pin !== pin) throw reject(422, "The PIN differs from the PCU record", field, "pcu_pin_mismatch");
        if (!["105", "109"].includes(record.code)) {
          throw reject(422, "The PCU result is not accepted", field, "pcu_result_not_accepted");
        }
        if (record.date !== today()) throw reject(422, "The PCU verification was not done today", field, "pcu_not_same_day");
        return;
      }
      case "OTP":
        if (body.one_time_pin !== MOCK_VALID_OTP) {
          throw reject(422, "Verification code is not valid", "one_time_pin", "code_invalid");
        }
        return;
      case "VALID_ID": {
        const key = `${pin}:${accreNo}:${today()}`;
        if (!validIdSeen.has(key) && !body.valid_id_image) {
          throw reject(400, "Invalid request payload", "valid_id_image", "validation_error");
        }
        validIdSeen.add(key);
      }
    }
  }

  const accepted = (form: UploadForm, match: (upload: Upload) => boolean) =>
    uploads.filter((u) => u.form === form && u.status === "accepted" && match(u));

  function latestConsultation(pin: string, accreNo: string) {
    return accepted("consultation", (u) => u.accreNo === accreNo && u.body.soap.patient_pin === pin)
      .sort((a, b) => {
        const byDate = usDateValue(b.body.soap.consultation_date) - usDateValue(a.body.soap.consultation_date);
        return byDate || String(b.body.soap.consultation_time).localeCompare(String(a.body.soap.consultation_time));
      })[0];
  }

  const acceptedFpe = (pin: string, accreNo: string) =>
    accepted("fpe", (u) => u.accreNo === accreNo && u.body.enlistment.patient_pin === pin)[0];

  // Returns the parent's state: "ok", "wait" or a rejection.
  function parentState(upload: Upload): "ok" | "wait" | Issue {
    const { form, echo } = upload;
    const find = (parentForm: UploadForm, field: string, value: string, path: string) => {
      const parent = uploads.filter(
        (u) => u.form === parentForm && u.accreNo === upload.accreNo && u.echo[field] === value,
      ).at(-1);
      if (!parent || parent.status === "rejected") return { field: path, issue: "validation_error" };
      return parent.status === "accepted" ? ("ok" as const) : ("wait" as const);
    };

    if (form === "fpe") return "ok";
    if (form === "consultation") return find("fpe", "case_no", echo.case_no, "soap.case_no");

    if (form === "diagnostic_results") {
      return find(
        "diagnostic_request",
        "request_transaction_no",
        echo.request_transaction_no,
        "diagnosticresult.request_transaction_no",
      );
    }
    const path = {
      diagnostic_request: "diagrequest[0].soap_transaction_no",
      medicine: "medicine[0].soap_transaction_no",
      referral: "soap.soap_transaction_no",
    }[form];
    const parent = find("consultation", "soap_transaction_no", echo.soap_transaction_no, path);
    if (parent !== "ok" || form === "diagnostic_request") return parent;

    // Guide 4.6.5 and 4.6.6: the consultation must announce the prescription or referral.
    const consultation = uploads.find(
      (u) =>
        u.form === "consultation" &&
        u.accreNo === upload.accreNo &&
        u.echo.soap_transaction_no === echo.soap_transaction_no &&
        u.status === "accepted",
    );
    const flag = form === "medicine" ? "medication_prescription_flag" : "referral_flag";
    return consultation?.body.management[flag] === "Y"
      ? "ok"
      : { field: path, issue: "validation_error" };
  }

  function hasRejectName(body: Json) {
    return (body.enlistment?.patient_lname ?? body.soap?.patient_lname) === REJECT_UPLOAD_LNAME;
  }

  function processQueue() {
    for (const upload of uploads) {
      if (upload.status !== "queued" && upload.status !== "processing") continue;
      if (hasRejectName(upload.body)) {
        const group = upload.body.enlistment ? "enlistment" : "soap";
        finish(upload, [{ field: `${group}.patient_lname`, issue: "validation_error" }]);
        continue;
      }
      const state = parentState(upload);
      if (state === "wait") {
        upload.status = "processing";
      } else {
        finish(upload, state === "ok" ? [] : [state]);
      }
    }
    // A child may have been checked before its parent finished.
    if (uploads.some((u) => u.status === "processing")) {
      setTimeout(processQueue, processDelayMs).unref();
    }
  }

  function finish(upload: Upload, errors: Issue[]) {
    upload.status = errors.length ? "rejected" : "accepted";
    upload.errors = errors;
    upload.processedAt = pst();
  }

  function handleUpload(form: UploadForm, body: Json, accreNo: string) {
    const record = uploadRecord(form, body);
    const contentHash = hashOf(body);
    const existing = uploads
      .filter((u) => u.form === form && u.accreNo === accreNo && u.recordKey === record.key)
      .at(-1);

    if (existing && existing.status !== "rejected") {
      if (existing.contentHash !== contentHash) {
        throw reject(409, "The record already exists", "transaction_no", "transaction_already_exists");
      }
      return { status: 200, data: uploadResponse(existing) };
    }

    const upload: Upload = {
      uploadNo: nextSeries(accreNo, "U"),
      form,
      accreNo,
      body,
      recordKey: record.key,
      contentHash,
      echo: record.echo,
      status: "queued",
      receivedAt: pst(),
      errors: [],
    };
    uploads.push(upload);
    setTimeout(processQueue, processDelayMs).unref();
    return { status: 202, data: uploadResponse(upload) };
  }

  const uploadResponse = (upload: Upload) => ({
    upload_transaction_no: upload.uploadNo,
    form: upload.form,
    processing_status: upload.status,
    ...upload.echo,
  });

  function handleValidator(body: Json, accreNo: string) {
    const lastName = body.last_name;
    let pin = body.patient_pin;
    if (!pin) {
      if (lastName === LOOKUP_NOT_FOUND) throw reject(404, "Beneficiary not found", "patient_pin", "beneficiary_not_found");
      if (lastName === LOOKUP_MULTIPLE) throw reject(422, "More than one beneficiary matches", "patient_pin", "multiple_matches");
      pin = "123456789012";
    }
    requireBeneficiary(pin);

    const selection = selections.get(pin);
    const pcu = latestPcu.get(pin);
    const fpe = acceptedFpe(pin, accreNo);
    const empanelment = empanelments.get(`${pin}:${accreNo}:${currentYear()}`);
    const consultation = latestConsultation(pin, accreNo);
    const assignedHere = selection?.status === "ASSIGNED" && selection.accreNo === accreNo;

    return {
      patient_pin: pin,
      accre_no: accreNo,
      eff_year: body.eff_year || currentYear(),
      ...(assignedHere
        ? {
            patient_lname: fpe?.body.enlistment.patient_lname ?? "DELA CRUZ",
            patient_fname: fpe?.body.enlistment.patient_fname ?? "MARIA",
            patient_mname: "SANTOS",
            patient_extname: "",
            patient_dob: "07/04/1990",
          }
        : { message: "The beneficiary is not assigned in this facility." }),
      pcu: pcu
        ? {
            status: pcu.verified ? "VERIFIED" : "FAILED",
            latest_date: pcu.date,
            transaction_no: pcu.transNo,
          }
        : { status: "UNVERIFIED" },
      selection: selection
        ? { status: selection.status, transaction_no: selection.transactionNo, date: selection.date }
        : { status: "NOT_ASSIGNED" },
      fpe: fpe
        ? {
            status: "Y",
            date: fpe.body.profile.fpe_date,
            transaction_no: fpe.echo.profile_transaction_no,
            upload_transaction_no: fpe.uploadNo,
          }
        : { status: "N" },
      empanelment: empanelment
        ? { status: "Y", date: empanelment.date, transaction_no: empanelment.yes_reference_no }
        : { status: "N" },
      consultation: consultation
        ? {
            status: "Y",
            date: consultation.body.soap.consultation_date,
            transaction_no: consultation.echo.soap_transaction_no,
            upload_transaction_no: consultation.uploadNo,
          }
        : { status: "N" },
    };
  }

  function handleSelection(body: Json, accreNo: string) {
    requireBeneficiary(body.patient_pin);
    if (usDateValue(body.selection_date) > usDateValue(today())) {
      throw reject(400, "Invalid request payload", "selection_date", "validation_error");
    }
    checkVerification(body, accreNo);

    const existing = selections.get(body.patient_pin);
    if (existing?.status === "ASSIGNED" && existing.accreNo === accreNo) {
      throw reject(409, "The beneficiary is already assigned to this facility", "patient_pin", "selection_already_exists");
    }
    if (existing?.status === "ASSIGNED" || existing?.status === "TRANSFERRED") {
      throw reject(422, "The beneficiary is not assigned in this facility.", "patient_pin", "selected_other_facility");
    }

    const selection = {
      accreNo,
      status: "ASSIGNED",
      transactionNo: nextSeries(accreNo, "K"),
      date: body.selection_date,
    };
    selections.set(body.patient_pin, selection);
    return {
      patient_pin: body.patient_pin,
      accre_no: accreNo,
      selection: {
        status: selection.status,
        transaction_no: selection.transactionNo,
        date: selection.date,
      },
    };
  }

  function handleEmpanelment(body: Json, accreNo: string) {
    const pin = body.patient_pin;
    requireBeneficiary(pin);
    checkVerification(body, accreNo);

    const year = currentYear();
    const key = `${pin}:${accreNo}:${year}`;
    if (empanelments.has(key)) {
      throw reject(409, "Empanelment already exists", "patient_pin", "empanelment_already_exists");
    }
    const selection = selections.get(pin);
    if (selection?.status !== "ASSIGNED" || selection.accreNo !== accreNo) {
      throw reject(422, "No active selection at this facility", "patient_pin", "no_active_selection");
    }
    const fpe = acceptedFpe(pin, accreNo);
    if (!fpe) throw reject(422, "No accepted FPE at this facility", "patient_pin", "no_accepted_fpe");

    const yes_reference_no = `MCA${randomBytes(4).toString("hex").slice(0, 7).toUpperCase()}`;
    empanelments.set(key, { yes_reference_no, date: today() });
    return {
      yes_reference_no,
      patient_pin: pin,
      accre_no: accreNo,
      eff_year: year,
      with_yes: true,
      with_fpe: true,
      fpe_transaction_no: fpe.echo.profile_transaction_no,
      pcu_transaction_code: body.pcu_transaction_code ?? "",
    };
  }

  function assignmentRow(pin: string, selection: Selection) {
    const statusCode = { ASSIGNED: "1", CANCELLED: "2", TRANSFERRED: "3" }[selection.status] ?? "1";
    return {
      patient_pin: pin,
      patient_lname: "DELA CRUZ",
      patient_fname: "MARIA",
      patient_mname: "SANTOS",
      patient_extname: "",
      patient_dob: "07/04/1990",
      patient_sex: "F",
      patient_type: "MM",
      member_pin: pin,
      member_lname: "DELA CRUZ",
      member_fname: "MARIA",
      member_mname: "SANTOS",
      member_extname: "",
      member_dob: "07/04/1990",
      member_sex: "F",
      patient_mobile_no: "09171234567",
      patient_landline_no: "",
      member_category: "01",
      member_category_desc: "Mock category",
      package_type: "K",
      assignment_date: selection.date,
      assignment_status: statusCode,
      eff_year: currentYear(),
    };
  }

  function handleMasterlistIndividual(body: Json, accreNo: string) {
    const selection = selections.get(body.patient_pin);
    if (selection?.accreNo !== accreNo) {
      throw reject(404, "Assignment not found", "patient_pin", "assignment_not_found");
    }
    return {
      accre_no: accreNo,
      transmittal_no: randomUUID(),
      eff_year: body.eff_year || currentYear(),
      total_records: 1,
      assignments: [assignmentRow(body.patient_pin, selection)],
    };
  }

  function handleMasterlistBatch(body: Json, accreNo: string) {
    const start = usDateValue(body.start_date);
    const end = usDateValue(body.end_date);
    if (end < start || end - start > 6 * 86_400_000) {
      throw reject(400, "Date range exceeds 7 days", "end_date", "validation_error");
    }
    const assignments = [...selections]
      .filter(([, s]) => s.accreNo === accreNo)
      .filter(([, s]) => usDateValue(s.date) >= start && usDateValue(s.date) <= end)
      .map(([pin, s]) => assignmentRow(pin, s));
    return {
      accre_no: accreNo,
      transmittal_no: randomUUID(),
      start_date: body.start_date,
      end_date: body.end_date,
      total_records: assignments.length,
      assignments,
    };
  }

  function handleVerificationCode(body: Json, accreNo: string) {
    if (body.patient_pin === SCENARIO_PINS.notFound) {
      throw reject(404, "Verification code not found", "patient_pin", "code_not_found");
    }
    if (body.one_time_pin !== MOCK_VALID_OTP) {
      throw reject(422, "Verification code is not valid", "one_time_pin", "code_invalid");
    }
    return {
      patient_pin: body.patient_pin,
      accre_no: accreNo,
      transaction_date: body.transaction_date,
      status: "VALID",
    };
  }

  function handlePcuStart(body: Json, accreNo: string, origin: string) {
    const authorizationId = randomUUID();
    const expiresAtMs = Date.now() + LIVENESS_TTL_MS;
    liveness.set(authorizationId, {
      accreNo,
      details: body,
      completed: false,
      used: false,
      expiresAtMs,
    });
    return {
      authorization_id: authorizationId,
      launch_token: randomBytes(24).toString("hex"),
      launch_url: `${origin}/liveness/capture`,
      sdk_url: `${origin}/liveness/sdk.js`,
      expires_at: pst(LIVENESS_TTL_MS),
    };
  }

  function handlePcuVerify(body: Json, accreNo: string) {
    const field = "liveness_authorization_id";
    const attempt = liveness.get(body.liveness_authorization_id);
    if (
      !attempt ||
      attempt.accreNo !== accreNo ||
      !attempt.completed ||
      attempt.used ||
      attempt.expiresAtMs < Date.now()
    ) {
      throw reject(403, "The LIVENESS authorization cannot be used for verification.", field, "invalid_liveness_authorization");
    }
    attempt.used = true;

    const { details } = attempt;
    const outcome = PCU_SCENARIOS[details.last_name] ?? {
      status: "success",
      code: "105",
      message: "PhilHealth Number found",
    };
    const memberPin = details.pin || "123456789012";
    const verified = ["105", "109"].includes(outcome.code);
    const transNo = `PCU${randomBytes(8).toString("hex").toUpperCase()}`;
    const record = { pin: memberPin, code: outcome.code, date: today(), transNo, verified };
    pcuRecords.set(transNo, record);
    latestPcu.set(memberPin, record);

    const assignment = selections.get(memberPin);
    return {
      request_id: randomUUID(),
      status: outcome.status,
      message: outcome.message,
      result_code: outcome.code,
      trans_no: transNo,
      verified: verified ? "Y" : "N",
      ...(details.pin && { pin_matched: "Y" }),
      member: { pin: memberPin, type: "M", sex: "M" },
      konsulta: {
        searched: true,
        available: true,
        assigned: assignment ? "YES" : "NO",
        hci_name: assignment ? "KONSULTA FACILITY" : "NOT YET ASSIGNED",
        date_assigned: "",
        message: "",
      },
    };
  }

  function handleAvailmentSlip(body: Json, accreNo: string) {
    const selection = selections.get(body.patient_pin);
    if (selection?.accreNo !== accreNo) {
      throw reject(404, "Availment not found", "patient_pin", "availment_not_found");
    }
  }

  // Each route: spec, and whether a success returns 201.
  const JSON_ROUTES: Record<
    string,
    { spec: SpecId; created?: boolean; run: (body: Json, accreNo: string, origin: string) => unknown }
  > = {
    "/pcu/start": { spec: "pcu_start", created: true, run: handlePcuStart },
    "/pcu/verify": { spec: "pcu_verify", run: handlePcuVerify },
    "/philhealth-yakap-validator": { spec: "validator", run: handleValidator },
    "/yakap-empanelment": { spec: "empanelment", created: true, run: handleEmpanelment },
    "/yakap-selection": { spec: "selection", created: true, run: handleSelection },
    "/yakap-selection-masterlist/individual": {
      spec: "masterlist_individual",
      run: handleMasterlistIndividual,
    },
    "/yakap-selection-masterlist/batch": { spec: "masterlist_batch", run: handleMasterlistBatch },
    "/yakap-patient-verification-code": { spec: "verification_code", run: handleVerificationCode },
  };

  function send(res: ServerResponse, status: number, body: Json) {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  }

  function respondSuccess(res: ServerResponse, status: number, message: string, data: unknown) {
    send(res, status, {
      status: "success",
      code: status,
      message,
      timestamp: pst(),
      request_id: randomUUID(),
      data,
    });
  }

  function respondError(res: ServerResponse, status: number, message: string, errors: Issue[]) {
    send(res, status, {
      status: "error",
      code: status,
      message,
      timestamp: pst(),
      request_id: randomUUID(),
      errors,
    });
  }

  async function readBody(req: IncomingMessage) {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks).toString("utf8");
  }

  function handleToken(raw: string, res: ServerResponse) {
    let body: Json;
    try {
      body = JSON.parse(raw);
    } catch {
      throw reject(400, "Invalid request payload", "body", "validation_error");
    }
    const issues = validateRequest("token", body);
    if (issues.length) {
      throw new Reject(400, "Invalid request payload", issues.map(({ field, issue }) => ({ field, issue })));
    }
    if (body.software_cert_id === MOCK_UNCERTIFIED_CERT_ID) {
      throw reject(403, "Software is not certified", "software_cert_id", "software_not_certified");
    }
    if (body.software_cert_id !== MOCK_CERT_ID || body.secret_key !== MOCK_SECRET_KEY) {
      throw reject(401, "Authentication failed", "secret_key", "invalid_credentials");
    }
    if (!MOCK_FACILITIES[body.accre_no]) {
      throw reject(403, "The facility is not linked", "accre_no", "facility_not_linked");
    }
    const token = `mock.${randomBytes(24).toString("hex")}`;
    tokens.set(token, { accreNo: body.accre_no, expiresAt: Date.now() + 3_600_000 });
    respondSuccess(res, 200, "Authentication successful", {
      access_token: token,
      token_type: "Bearer",
      expires_in: 3600,
    });
  }

  function authenticate(req: IncomingMessage) {
    const token = req.headers.authorization?.replace(/^Bearer /, "") ?? "";
    const session = tokens.get(token);
    if (!session || session.expiresAt < Date.now()) {
      throw reject(401, "Unauthorized", "authorization", "unauthorized");
    }
    return session.accreNo;
  }

  function decryptBody(raw: string, cipherKey: string): Json {
    let bytes: Buffer;
    try {
      bytes = decryptEnvelope(JSON.parse(raw), cipherKey);
    } catch (error) {
      const issue = error instanceof EnvelopeError ? error.issue : "decryption_failed";
      throw reject(400, "Request could not be decrypted", issue === "hash_mismatch" ? "hash" : "doc", issue);
    }
    return JSON.parse(bytes.toString("utf8"));
  }

  function checkRequest(spec: SpecId, body: Json, accreNo: string) {
    if (spec !== "pcu_start" && spec !== "pcu_verify" && body.consent !== true) {
      throw reject(403, "Consent is required", "consent", "consent_required");
    }
    const issues = validateRequest(spec, body, { accreNo });
    if (issues.length) {
      throw new Reject(400, "Invalid request payload", issues.map(({ field, issue }) => ({ field, issue })));
    }
  }

  // The backend recomputes these and rejects a mismatch (guide 4.6.1).
  function checkFpeComputedValues(body: Json) {
    const age = ageText(body.enlistment.patient_dob, body.profile.fpe_date);
    if (body.profile.patient_age !== age) {
      throw reject(400, "Invalid request payload", "profile.patient_age", "validation_error");
    }
    const bmi = computeBmi(body.pepert.weight, body.pepert.height ?? body.pepert.length);
    if (body.pepert.bmi !== bmi) {
      throw reject(400, "Invalid request payload", "pepert.bmi", "validation_error");
    }
  }

  function livenessPage(url: URL, res: ServerResponse) {
    if (url.pathname === "/liveness/sdk.js") {
      res.writeHead(200, { "Content-Type": "text/javascript" });
      res.end(`window.eKYC = function () {
  return {
    redirect: function (o) {
      var q = new URLSearchParams({ id: o.authorizationId, state: o.returnState, ret: o.returnUrl });
      location.href = o.launchUrl + "?" + q.toString();
      return Promise.resolve();
    },
  };
};`);
      return true;
    }
    if (url.pathname === "/liveness/capture") {
      const q = url.searchParams;
      const query = q.toString();
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><title>Mock LIVENESS</title><h1>Mock LIVENESS capture</h1>
<p>Development stand-in for the PhilHealth face capture.</p>
<p><a href="/liveness/finish?${query}&result=COMPLETED">Complete capture</a></p>
<p><a href="/liveness/finish?${query}&result=CANCELLED">Cancel</a></p>`);
      return true;
    }
    if (url.pathname === "/liveness/finish") {
      const id = url.searchParams.get("id") ?? "";
      const result = url.searchParams.get("result") ?? "CANCELLED";
      const attempt = liveness.get(id);
      if (attempt && result === "COMPLETED") attempt.completed = true;
      const fragment = new URLSearchParams({
        pcu_liveness_status: result,
        pcu_liveness_authorization_id: id,
        pcu_liveness_state: url.searchParams.get("state") ?? "",
      });
      res.writeHead(302, { Location: `${url.searchParams.get("ret")}#${fragment}` });
      res.end();
      return true;
    }
    return false;
  }

  async function route(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (req.method === "GET" && livenessPage(url, res)) return;

    if (!url.pathname.startsWith(BASE)) {
      return respondError(res, 404, "Not found", [{ field: "path", issue: "not_found" }]);
    }
    const path = url.pathname.slice(BASE.length);
    const raw = await readBody(req);

    if (req.method === "POST" && path === "/auth/token") return handleToken(raw, res);

    const accreNo = authenticate(req);
    const cipherKey = MOCK_FACILITIES[accreNo];
    const reply = (status: number, message: string, data: unknown) =>
      respondSuccess(res, status, message, encryptEnvelope(JSON.stringify(data), cipherKey));

    if (req.method === "GET" && path.startsWith("/yakap-data-upload/status/")) {
      const number = decodeURIComponent(path.split("/").at(-1) ?? "");
      if (number.length !== 23) {
        throw reject(400, "Invalid request", "upload_transaction_no", "validation_error");
      }
      const upload = uploads.find((u) => u.uploadNo === number && u.accreNo === accreNo);
      if (!upload) throw reject(404, "Upload not found", "upload_transaction_no", "upload_not_found");
      return reply(200, "Upload status retrieved", {
        ...uploadResponse(upload),
        received_at: upload.receivedAt,
        ...(upload.processedAt && { processed_at: upload.processedAt }),
        errors: upload.errors,
      });
    }

    if (req.method !== "POST") {
      return respondError(res, 404, "Not found", [{ field: "path", issue: "not_found" }]);
    }
    const body = decryptBody(raw, cipherKey);

    if (path.startsWith("/yakap-data-upload/")) {
      const form = UPLOAD_ROUTES[path.split("/").at(-1) ?? ""];
      if (!form) return respondError(res, 404, "Not found", [{ field: "path", issue: "not_found" }]);
      checkRequest(form, body, accreNo);
      if (form === "fpe") checkFpeComputedValues(body);
      const result = handleUpload(form, body, accreNo);
      return reply(result.status, "Upload received", result.data);
    }

    if (path === "/yakap-availment-slip") {
      checkRequest("availment_slip", body, accreNo);
      handleAvailmentSlip(body, accreNo);
      return respondSuccess(
        res,
        200,
        "Availment slip generated",
        encryptEnvelope(PDF, cipherKey, { mimeType: "application/pdf" }),
      );
    }

    const handler = JSON_ROUTES[path];
    if (!handler) return respondError(res, 404, "Not found", [{ field: "path", issue: "not_found" }]);
    checkRequest(handler.spec, body, accreNo);
    const data = handler.run(body, accreNo, url.origin);
    return reply(handler.created ? 201 : 200, "OK", data);
  }

  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      if (error instanceof Reject) {
        respondError(res, error.status, error.message, error.issues);
      } else {
        console.error(error);
        respondError(res, 500, "Internal error", [{ field: "", issue: "internal_error" }]);
      }
    });
  });

  return {
    server,
    listen(port = 0) {
      return new Promise<string>((resolve) => {
        server.listen(port, "127.0.0.1", () => {
          const address = server.address() as AddressInfo;
          resolve(`http://127.0.0.1:${address.port}/primary-care`);
        });
      });
    },
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
    /** Test helper: ends every session, as a PhilHealth revocation would. */
    revokeAllTokens() {
      tokens.clear();
    },
    /** Test helper: marks a capture finished without the browser step. */
    completeLiveness(authorizationId: string) {
      liveness.get(authorizationId)!.completed = true;
    },
    validIdTypes: () => libraries["Valid ID Type"].map((entry) => entry.code),
  };
}
