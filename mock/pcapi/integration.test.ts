import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { UploadForm } from "../../src/lib/pcapi-spec";
import { PcapiClient } from "../../src/server/pcapi/client";
import { PcapiError, PcapiValidationError } from "../../src/server/pcapi/errors";
import { encryptEnvelope } from "../../src/server/pcapi/envelope";
import { pcapiServices, type PcapiServices } from "../../src/server/pcapi/services";
import { validSample } from "../../tests/fixtures/samples";
import { MOCK_CERT_ID, MOCK_FACILITIES, MOCK_SECRET_KEY, SCENARIO_PINS } from "./config";
import { createMockPcapi } from "./server";

const ACCRE = "H12345678";
const mock = createMockPcapi({ processDelayMs: 5 });
let baseUrl: string;
let api: PcapiServices;

function clientFor(overrides = {}) {
  return new PcapiClient({
    baseUrl,
    softwareCertId: MOCK_CERT_ID,
    secretKey: MOCK_SECRET_KEY,
    cipherKeyFor: async (accreNo) => MOCK_FACILITIES[accreNo],
    ...overrides,
  });
}

beforeAll(async () => {
  baseUrl = await mock.listen();
  api = pcapiServices(clientFor(), ACCRE);
});
afterAll(() => mock.close());

const issueOf = async (call: Promise<unknown>) => {
  const error = (await call.catch((e) => e)) as PcapiError;
  expect(error).toBeInstanceOf(PcapiError);
  return { status: error.status, issue: error.issues[0].issue, field: error.issues[0].field };
};

let pinSeed = 100000000000;
const newPin = () => String(++pinSeed);

const today = () => {
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const [year, month, day] = now.split("-");
  return `${month}/${day}/${year}`;
};

async function verified(pin: string, lastName = "DELA CRUZ") {
  const start = await api.pcuStart({
    pin,
    first_name: "JUAN",
    last_name: lastName,
    birth_date: "01/31/1990",
  });
  mock.completeLiveness(start.data.authorization_id);
  return (await api.pcuVerify(start.data.authorization_id)).data;
}

const otp = (pin: string) => ({
  patient_pin: pin,
  consent: true,
  patient_verification_mode: "OTP",
  one_time_pin: "123456",
});

async function settle(number: string) {
  for (let i = 0; i < 200; i++) {
    const { data } = await api.uploadStatus(number);
    if (data.processing_status === "accepted" || data.processing_status === "rejected") {
      return data;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Upload did not finish");
}

let recordSeed = 1;

/** The guide's FPE sample with new record numbers, for the given patient. */
function fpeFor(pin: string) {
  const sample = validSample("fpe");
  const series = String(recordSeed++).padStart(5, "0");
  sample.enlistment.patient_pin = pin;
  sample.enlistment.case_no = `T${ACCRE}20261023${series}`;
  sample.enlistment.enlist_transaction_no = `E${ACCRE}20261023${series}`;
  sample.profile.profile_transaction_no = `P${ACCRE}20261023${series}`;
  return sample;
}

describe("authentication and transport", () => {
  it("rejects a wrong secret", async () => {
    const client = pcapiServices(clientFor({ secretKey: "wrong" }), ACCRE);
    expect(await issueOf(client.validator(validSample("validator")))).toMatchObject({
      status: 401,
      issue: "invalid_credentials",
    });
  });

  it("rejects a facility not linked to the certificate", async () => {
    const client = pcapiServices(clientFor(), "H00000000");
    expect(await issueOf(client.validator(validSample("validator")))).toMatchObject({
      status: 403,
      issue: "facility_not_linked",
    });
  });

  it("recovers on its own when PhilHealth revokes the token", async () => {
    await api.validator(validSample("validator"));
    mock.revokeAllTokens();
    await expect(api.validator(validSample("validator"))).resolves.toBeDefined();
  });

  it("recovers on its own when the server treats the token as expired", async () => {
    await api.validator(validSample("validator"));
    mock.expireAllTokens();
    await expect(api.validator(validSample("validator"))).resolves.toBeDefined();
  });

  it("is refused when the wrong cipher key is used", async () => {
    const bad = pcapiServices(clientFor({ cipherKeyFor: async () => "wrong-key" }), ACCRE);
    expect(await issueOf(bad.validator(validSample("validator")))).toMatchObject({
      status: 400,
      issue: "hash_mismatch",
    });
  });

  it("gets hash_mismatch when the hash does not match", async () => {
    const token = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: "POST",
      body: JSON.stringify({
        software_cert_id: MOCK_CERT_ID,
        accre_no: ACCRE,
        secret_key: MOCK_SECRET_KEY,
      }),
    }).then((r) => r.json());
    const envelope = {
      ...encryptEnvelope("{}", MOCK_FACILITIES[ACCRE]),
      hash: "0".repeat(64),
    };
    const response = await fetch(`${baseUrl}/api/v1/philhealth-yakap-validator`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token.data.access_token}` },
      body: JSON.stringify(envelope),
    });
    expect(response.status).toBe(400);
    expect((await response.json()).errors[0].issue).toBe("hash_mismatch");
  });

  it("stops an invalid request before it is sent", async () => {
    await expect(
      api.validator({ patient_pin: "123", consent: true }),
    ).rejects.toBeInstanceOf(PcapiValidationError);
  });

  it("reports consent_required when an encrypted request lacks consent", async () => {
    const client = clientFor();
    const error = await client
      .callJson({
        accreNo: ACCRE,
        method: "POST",
        path: "/api/v1/philhealth-yakap-validator",
        body: { patient_pin: "123456789012", consent: false },
        retry: false,
      })
      .catch((e) => e);
    expect(error.status).toBe(403);
    expect(error.hasIssue("consent_required")).toBe(true);
  });
});

describe("PhilHealth Check", () => {
  it("verifies once and stores nothing reusable", async () => {
    const pin = newPin();
    const start = await api.pcuStart({
      pin,
      first_name: "JUAN",
      last_name: "DELA CRUZ",
      birth_date: "01/31/1990",
    });
    expect(start.status).toBe(201);
    expect(start.data.sdk_url).toContain("/liveness/sdk.js");

    expect(await issueOf(api.pcuVerify(start.data.authorization_id))).toMatchObject({
      status: 403,
      issue: "invalid_liveness_authorization",
    });

    mock.completeLiveness(start.data.authorization_id);
    const result = await api.pcuVerify(start.data.authorization_id);
    expect(result.data).toMatchObject({ status: "success", result_code: "105", verified: "Y" });
    expect(result.data.trans_no.length).toBeLessThanOrEqual(20);

    expect(await issueOf(api.pcuVerify(start.data.authorization_id))).toMatchObject({
      issue: "invalid_liveness_authorization",
    });
  });

  it("returns a failed check as HTTP 200 with a business status", async () => {
    const result = await verified(newPin(), "NORECORD");
    expect(result).toMatchObject({ status: "norecord", result_code: "108" });
  });
});

describe("Primary Care Validator", () => {
  it("omits identity and stage details for an unassigned beneficiary", async () => {
    const { data } = await api.validator({ patient_pin: newPin(), consent: true });
    expect(data.selection).toEqual({ status: "NOT_ASSIGNED" });
    expect(data.pcu).toEqual({ status: "UNVERIFIED" });
    expect(data.fpe).toEqual({ status: "N" });
    expect(data.patient_lname).toBeUndefined();
    expect(data.message).toBeDefined();
  });

  it.each([
    [SCENARIO_PINS.notFound, 404, "beneficiary_not_found"],
    [SCENARIO_PINS.deceased, 422, "beneficiary_deceased"],
  ])("reports %s", async (patient_pin, status, issue) => {
    expect(await issueOf(api.validator({ patient_pin, consent: true }))).toMatchObject({
      status,
      issue,
    });
  });

  it("reports several matches on a name lookup", async () => {
    expect(
      await issueOf(
        api.validator({
          first_name: "A",
          last_name: "MULTIPLE",
          patient_dob: "01/01/1990",
          consent: true,
        }),
      ),
    ).toMatchObject({ status: 422, issue: "multiple_matches" });
  });
});

describe("the beneficiary journey", () => {
  it("runs from verification through selection, FPE and empanelment", async () => {
    const pin = newPin();
    const check = await verified(pin);
    const evidence = {
      patient_pin: pin,
      consent: true,
      patient_verification_mode: "PCU",
      pcu_transaction_code: check.trans_no,
    };

    expect(
      await issueOf(api.empanelment({ ...evidence, created_by: "emr.user01" })),
    ).toMatchObject({ status: 422, issue: "no_active_selection" });

    const selection = await api.selection({ ...evidence, selection_date: today() });
    expect(selection.status).toBe(201);
    expect(selection.data.selection.transaction_no).toHaveLength(23);
    expect(selection.data.selection.transaction_no[0]).toBe("K");

    expect(
      await issueOf(api.selection({ ...evidence, selection_date: today() })),
    ).toMatchObject({ status: 409, issue: "selection_already_exists" });

    expect(
      await issueOf(api.empanelment({ ...evidence, created_by: "emr.user01" })),
    ).toMatchObject({ status: 422, issue: "no_accepted_fpe" });

    const upload = await api.upload("fpe", fpeFor(pin));
    expect(upload.status).toBe(202);
    expect(upload.data.processing_status).toBe("queued");
    const status = await settle(upload.data.upload_transaction_no);
    expect(status.processing_status).toBe("accepted");

    const empanelment = await api.empanelment({ ...evidence, created_by: "emr.user01" });
    expect(empanelment.status).toBe(201);
    expect(empanelment.data.yes_reference_no).toMatch(/^MCA.{7}$/);

    expect(
      await issueOf(api.empanelment({ ...evidence, created_by: "emr.user01" })),
    ).toMatchObject({ status: 409, issue: "empanelment_already_exists" });

    const { data } = await api.validator({ patient_pin: pin, consent: true });
    expect(data).toMatchObject({
      pcu: { status: "VERIFIED" },
      selection: { status: "ASSIGNED" },
      fpe: { status: "Y" },
      empanelment: { status: "Y" },
    });
    expect(data.patient_lname).toBeDefined();

    const slip = await api.availmentSlip({ patient_pin: pin, eff_year: "2026", consent: true });
    expect(slip.data.subarray(0, 5).toString()).toBe("%PDF-");
    expect(slip.data.subarray(-5).toString()).toBe("%%EOF");

    const masterlist = await api.masterlistIndividual({ patient_pin: pin, consent: true });
    expect(masterlist.data.total_records).toBe(1);
    const batch = await api.masterlistBatch({ start_date: today(), end_date: today(), consent: true });
    expect(batch.data.assignments.some((a) => a.patient_pin === pin)).toBe(true);
  });

  it.each([
    [SCENARIO_PINS.assignedElsewhere, 422, "selected_other_facility"],
    [SCENARIO_PINS.transferred, 422, "selected_other_facility"],
  ])("refuses selection for %s", async (pin, status, issue) => {
    expect(
      await issueOf(api.selection({ ...otp(pin), selection_date: today() })),
    ).toMatchObject({ status, issue });
  });

  it("allows reselection after a cancelled assignment", async () => {
    const { data } = await api.selection({
      ...otp(SCENARIO_PINS.cancelled),
      selection_date: today(),
    });
    expect(data.selection.status).toBe("ASSIGNED");
  });

  it("refuses a selection date in the future", async () => {
    expect(
      await issueOf(api.selection({ ...otp(newPin()), selection_date: "12/31/2099" })),
    ).toMatchObject({ status: 400, issue: "validation_error", field: "selection_date" });
  });

  it("rejects PCU evidence that fails its checks", async () => {
    const pin = newPin();
    const failed = await verified(pin, "NORECORD");
    const base = { patient_verification_mode: "PCU", consent: true, selection_date: today() };

    expect(
      await issueOf(
        api.selection({ ...base, patient_pin: pin, pcu_transaction_code: failed.trans_no }),
      ),
    ).toMatchObject({ issue: "pcu_result_not_accepted" });
    expect(
      await issueOf(
        api.selection({ ...base, patient_pin: newPin(), pcu_transaction_code: failed.trans_no }),
      ),
    ).toMatchObject({ issue: "pcu_pin_mismatch" });
    expect(
      await issueOf(
        api.selection({ ...base, patient_pin: pin, pcu_transaction_code: "NOSUCH" }),
      ),
    ).toMatchObject({ status: 404, issue: "pcu_transaction_not_found" });
  });

  it("requires a Valid ID image only on the first request of the day", async () => {
    const pin = newPin();
    const evidence = {
      patient_pin: pin,
      consent: true,
      selection_date: today(),
      patient_verification_mode: "VALID_ID",
      valid_id_type: mock.validIdTypes()[0],
    };
    expect(await issueOf(api.selection(evidence))).toMatchObject({
      status: 400,
      field: "valid_id_image",
    });
    const selection = await api.selection({ ...evidence, valid_id_image: "/9j/AAAA" });
    expect(selection.status).toBe(201);
  });
});

describe("Data Upload", () => {
  async function acceptedFpe() {
    const pin = newPin();
    const body = fpeFor(pin);
    const upload = await api.upload("fpe", body);
    await settle(upload.data.upload_transaction_no);
    return { pin, caseNo: body.enlistment.case_no as string };
  }

  function consultationFor(pin: string, caseNo: string, soapNo: string) {
    const sample = validSample("consultation");
    sample.soap.case_no = caseNo;
    sample.soap.patient_pin = pin;
    sample.soap.soap_transaction_no = soapNo;
    return sample;
  }

  const soapNumber = () => `S${ACCRE}20261023${String(recordSeed++).padStart(5, "0")}`;

  it("treats an identical resend as the same submission", async () => {
    const body = fpeFor(newPin());
    const first = await api.upload("fpe", body);
    const second = await api.upload("fpe", body);
    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.data.upload_transaction_no).toBe(first.data.upload_transaction_no);
  });

  it("refuses the same record number with different content", async () => {
    const body = fpeFor(newPin());
    await api.upload("fpe", body);
    const changed = { ...body, enlistment: { ...body.enlistment, patient_fname: "OTHER" } };
    expect(await issueOf(api.upload("fpe", changed))).toMatchObject({
      status: 409,
      issue: "transaction_already_exists",
    });
  });

  it("lets a rejected record be corrected under the same number", async () => {
    const body = fpeFor(newPin());
    body.enlistment.patient_lname = "REJECT";
    const first = await api.upload("fpe", body);
    const status = await settle(first.data.upload_transaction_no);
    expect(status.processing_status).toBe("rejected");
    expect(status.errors).toEqual([
      { field: "enlistment.patient_lname", issue: "validation_error" },
    ]);

    body.enlistment.patient_lname = "DELA CRUZ";
    const second = await api.upload("fpe", body);
    expect(second.status).toBe(202);
    expect(second.data.upload_transaction_no).not.toBe(first.data.upload_transaction_no);
    expect((await settle(second.data.upload_transaction_no)).processing_status).toBe("accepted");
  });

  it("rejects a consultation with no accepted FPE", async () => {
    const body = consultationFor(newPin(), `T${ACCRE}2026102399999`, soapNumber());
    const upload = await api.upload("consultation", body);
    const status = await settle(upload.data.upload_transaction_no);
    expect(status.processing_status).toBe("rejected");
    expect(status.errors[0].field).toBe("soap.case_no");
  });

  it("links child records to an accepted consultation and rejects them otherwise", async () => {
    const { pin, caseNo } = await acceptedFpe();
    const soapNo = soapNumber();
    const consultation = await api.upload("consultation", consultationFor(pin, caseNo, soapNo));
    expect((await settle(consultation.data.upload_transaction_no)).processing_status).toBe("accepted");

    const { data } = await api.validator({ patient_pin: pin, consent: true });
    expect(data.consultation).toMatchObject({ status: "Y", transaction_no: soapNo });

    const send = async (form: UploadForm, build: (body: any) => void) => { // eslint-disable-line @typescript-eslint/no-explicit-any
      const body = validSample(form);
      build(body);
      return api.upload(form, body);
    };
    const link = (row: { case_no: string; soap_transaction_no: string }) => {
      row.case_no = caseNo;
      row.soap_transaction_no = soapNo;
    };

    const request = await send("diagnostic_request", (b) => b.diagrequest.forEach(link));
    expect((await settle(request.data.upload_transaction_no)).processing_status).toBe("accepted");

    const results = await send("diagnostic_results", (b) => link(b.diagnosticresult));
    const resultStatus = await settle(results.data.upload_transaction_no);
    expect(resultStatus.processing_status).toBe("accepted");
    expect(Array.isArray(resultStatus.result_transaction_no)).toBe(true);

    const medicine = await send("medicine", (b) => b.medicine.forEach(link));
    expect((await settle(medicine.data.upload_transaction_no)).processing_status).toBe("accepted");

    const referral = await send("referral", (b) => link(b.soap));
    expect((await settle(referral.data.upload_transaction_no)).processing_status).toBe("accepted");

    const orphan = await send("referral", (b) => {
      b.soap.soap_transaction_no = soapNumber();
      b.referral.referral_transaction_no = `R${ACCRE}2026102377777`;
    });
    expect((await settle(orphan.data.upload_transaction_no)).processing_status).toBe("rejected");
  });

  it("reports an unknown upload number", async () => {
    expect(await issueOf(api.uploadStatus(`U${ACCRE}2026010199999`))).toMatchObject({
      status: 404,
      issue: "upload_not_found",
    });
  });
});

describe("other services", () => {
  const code = (patient_pin: string, one_time_pin: string) =>
    api.verificationCode({
      patient_pin,
      one_time_pin,
      transaction_date: today(),
      consent: true,
    });

  it("validates a verification code", async () => {
    expect((await code("123456789012", "123456")).data.status).toBe("VALID");
    expect(await issueOf(code("123456789012", "999999"))).toMatchObject({
      status: 422,
      issue: "code_invalid",
    });
    expect(await issueOf(code(SCENARIO_PINS.notFound, "123456"))).toMatchObject({
      status: 404,
      issue: "code_not_found",
    });
  });

  it("limits the masterlist batch to 7 days", async () => {
    expect(
      await issueOf(
        api.masterlistBatch({ start_date: "10/01/2026", end_date: "10/08/2026", consent: true }),
      ),
    ).toMatchObject({ status: 400, field: "end_date" });
    const { data } = await api.masterlistBatch({
      start_date: "10/01/2026",
      end_date: "10/07/2026",
      consent: true,
    });
    expect(data.total_records).toBe(0);
  });

  it("reports no assignment and no slip", async () => {
    const pin = newPin();
    expect(await issueOf(api.masterlistIndividual({ patient_pin: pin, consent: true }))).toMatchObject({
      status: 404,
      issue: "assignment_not_found",
    });
    expect(
      await issueOf(api.availmentSlip({ patient_pin: pin, eff_year: "2026", consent: true })),
    ).toMatchObject({ status: 404, issue: "availment_not_found" });
  });
});
