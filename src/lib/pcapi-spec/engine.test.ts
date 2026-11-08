import { describe, expect, it } from "vitest";
import { GUIDE_SAMPLE_GAPS, guideSample, validSample } from "../../../tests/fixtures/samples";
import {
  libraries,
  rulesFor,
  serializeRequest,
  unknownRequestFields,
  validateRequest,
  type SpecId,
} from ".";

const fixture = validSample;

const SAMPLES: SpecId[] = [
  "validator",
  "empanelment",
  "selection",
  "masterlist_individual",
  "masterlist_batch",
  "fpe",
  "consultation",
  "diagnostic_request",
  "diagnostic_results",
  "medicine",
  "referral",
  "verification_code",
  "availment_slip",
];

describe("generated spec", () => {
  it("covers every Data Dictionary annex", () => {
    expect(rulesFor("fpe").length).toBe(144); // 143 fields plus consent
    expect(rulesFor("consultation").length).toBe(271);
    expect(rulesFor("diagnostic_request").length).toBe(8);
    expect(rulesFor("diagnostic_results").length).toBe(138);
    expect(rulesFor("medicine").length).toBe(32);
    expect(rulesFor("referral").length).toBe(33);
  });

  it("has all library worksheets with active codes only", () => {
    expect(Object.keys(libraries)).toHaveLength(72);
    expect(libraries["Sex"].map((entry) => entry.code).sort()).toEqual(["F", "M"]);
    expect(libraries["Enlistment Status"].map((entry) => entry.code)).toEqual(["1", "2", "3"]);
  });
});

describe("guide request samples", () => {
  it.each(SAMPLES)("%s defines every field the guide sends", (id) => {
    expect(unknownRequestFields(id, fixture(id))).toEqual([]);
  });

  it.each(SAMPLES)("%s passes validation once its known gaps are filled", (id) => {
    expect(validateRequest(id, fixture(id))).toEqual([]);
  });

  it.each(Object.entries(GUIDE_SAMPLE_GAPS))(
    "%s sample lacks only the listed conditional fields",
    (id, gaps) => {
      const issues = validateRequest(id as SpecId, guideSample(id));
      expect(issues.map((issue) => issue.field).sort()).toEqual([...gaps].sort());
    },
  );
});

describe("validation", () => {
  const selection = () => fixture("selection");

  it("reports a missing required field by its JSON path", () => {
    const body = selection();
    delete body.patient_pin;
    expect(validateRequest("selection", body)).toEqual([
      { field: "patient_pin", issue: "validation_error", reason: "required" },
    ]);
  });

  it("never accepts null", () => {
    const body = selection();
    body.pcu_transaction_code = null;
    expect(validateRequest("selection", body)[0].reason).toBe("null_not_accepted");
  });

  it("rejects an optional string that is left out", () => {
    const body = selection();
    delete body.pcu_transaction_code;
    expect(validateRequest("selection", body)[0].reason).toBe("must_be_present");
  });

  it("applies verification evidence conditions", () => {
    const body = selection();
    body.patient_verification_mode = "PCU";
    body.one_time_pin = "";
    expect(validateRequest("selection", body)).toEqual([
      { field: "pcu_transaction_code", issue: "validation_error", reason: "required" },
    ]);
  });

  it("checks size in bytes, so ñ counts as two", () => {
    const body = fixture("fpe");
    body.enlistment.created_by = "ñ".repeat(76);
    expect(validateRequest("fpe", body)[0].reason).toBe("too_long");
    body.enlistment.created_by = "ñ".repeat(75);
    expect(validateRequest("fpe", body)).toEqual([]);
  });

  it("rejects impossible dates", () => {
    const body = selection();
    body.selection_date = "02/30/2026";
    expect(validateRequest("selection", body)[0].reason).toBe("bad_date_format");
  });

  it("rejects codes outside the library", () => {
    const body = selection();
    body.patient_verification_mode = "FACE";
    const reasons = validateRequest("selection", body).map((issue) => issue.reason);
    expect(reasons).toContain("unknown_library_code");
  });

  it("requires consent to be true", () => {
    const body = selection();
    body.consent = false;
    expect(validateRequest("selection", body)[0].reason).toBe("must_be_true");
  });

  it("needs the guardian group for a dependent and refuses it for a member", () => {
    const fpe = fixture("fpe");
    const guardian = { guardian_relationship: "01" };

    const member: Record<string, unknown> & { enlistment: object } = {
      ...fpe,
      enlistment: { ...fpe.enlistment, patient_type: "MM" },
    };
    delete member.guardian;
    expect(validateRequest("fpe", member)).toEqual([]);

    const memberWithGuardian = { ...member, guardian };
    expect(
      validateRequest("fpe", memberWithGuardian).some(
        (issue) => issue.reason === "must_be_absent",
      ),
    ).toBe(true);

    const dependent = { ...member, enlistment: { ...member.enlistment, patient_type: "DD" } };
    expect(
      validateRequest("fpe", dependent).some(
        (issue) => issue.field.startsWith("guardian.") && issue.reason === "required",
      ),
    ).toBe(true);
  });

  it("checks a record number's prefix and facility", () => {
    const body = fixture("fpe");
    expect(validateRequest("fpe", body, { accreNo: "H12345678" })).toEqual([]);
    expect(
      validateRequest("fpe", body, { accreNo: "H99999999" }).some(
        (issue) => issue.reason === "accre_no_mismatch",
      ),
    ).toBe(true);
  });

  it("reports array fields with their index", () => {
    const body = fixture("medicine");
    delete body.medicine[0].drug_code;
    expect(validateRequest("medicine", body)[0].field).toBe("medicine[0].drug_code");
  });
});

describe("serialization", () => {
  it("fills optional strings with empty values and drops the rest", () => {
    const output = serializeRequest("selection", {
      patient_pin: "123456789012",
      selection_date: "10/25/2026",
      consent: true,
      patient_verification_mode: "OTP",
      one_time_pin: "ABC",
      valid_id_type: null,
      not_in_spec: "dropped",
    });
    expect(output).toEqual({
      patient_pin: "123456789012",
      selection_date: "10/25/2026",
      consent: true,
      patient_verification_mode: "OTP",
      pcu_transaction_code: "",
      one_time_pin: "ABC",
      valid_id_type: "",
      valid_id_image: "",
    });
    expect(validateRequest("selection", output)).toEqual([]);
  });

  it("leaves out empty numbers and groups that were not supplied", () => {
    const fpe = fixture("fpe");
    const input: Record<string, unknown> = { ...fpe, pepert: { ...fpe.pepert, height: "" } };
    delete input.gynehist;
    const output = serializeRequest("fpe", input);
    expect("height" in (output.pepert as object)).toBe(false);
    expect("gynehist" in output).toBe(false);
  });

  it("keeps every sample valid and is stable when applied twice", () => {
    for (const id of SAMPLES) {
      const once = serializeRequest(id, fixture(id));
      expect(validateRequest(id, once)).toEqual([]);
      expect(serializeRequest(id, once)).toEqual(once);
    }
  });

  it("sends a conditional value as empty when its rule does not apply", () => {
    const sample = fixture("fpe");
    expect(sample.sochist.dental_checkup_status).not.toBe("Y");
    sample.sochist.dental_checkup_year = "2025";
    const output = serializeRequest("fpe", sample) as typeof sample;
    expect(output.sochist.dental_checkup_year).toBe("");
  });
});
