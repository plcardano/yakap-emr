import { describe, expect, it } from "vitest";
import { librariesFor, rulesFor } from "@/lib/pcapi-spec";
import type { UploadForm } from "@/lib/pcapi-spec/types";
import { validSample } from "../../../tests/fixtures/samples";
import { computeQuantity } from "./children";
import { createChecker, stepIndexFor } from "./checker";
import { FORM_DEFINITIONS } from "./registry";

const FORMS = Object.keys(FORM_DEFINITIONS) as UploadForm[];
const checker = (form: UploadForm) =>
  createChecker(FORM_DEFINITIONS[form], rulesFor(form), librariesFor(form));
const fieldsOf = (form: UploadForm, values: object) =>
  checker(form).check(values).issues.map((issue) => issue.field);

describe.each(FORMS)("%s definition", (form) => {
  const definition = FORM_DEFINITIONS[form];

  it("puts every data group in exactly one step", () => {
    const groups = definition.steps.flatMap((step) => step.groups);
    const inRules = new Set(rulesFor(form).map((rule) => rule.path.split(/[.[]/)[0]));
    inRules.delete("consent");
    expect(new Set(groups)).toEqual(inRules);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("only names fields that exist", () => {
    const paths = new Set(rulesFor(form).map((rule) => rule.path));
    for (const path of [...definition.hidden, ...definition.readOnly.keys()]) {
      expect(paths, path).toContain(path);
    }
  });

  it("accepts the guide's sample", () => {
    expect(checker(form).check(validSample(form)).issues).toEqual([]);
  });
});

describe("Consultation", () => {
  const sample = () => validSample("consultation");

  it("leaves out Specific Forms that were not chosen", () => {
    const values = {
      ...sample(),
      __forms: { obgyne: false, pedia: false, adol: false, headsss: false, bp: false },
    };
    const { body, issues } = checker("consultation").check(values);
    expect(issues).toEqual([]);
    expect(Object.keys(body).filter((key) => key.startsWith("sf_"))).toEqual([]);
  });

  it("keeps OB-Gyn away from male patients", () => {
    const { body } = checker("consultation").check({
      ...sample(),
      __patient: { sex: "M" },
    });
    expect(body.sf_obgyne_menshist).toBeUndefined();
  });

  it("requires a Specific Form's fields only once it is chosen", () => {
    const values = sample();
    for (const key of Object.keys(values)) if (key.startsWith("sf_")) delete values[key];
    expect(checker("consultation").check(values).issues).toEqual([]);
    expect(fieldsOf("consultation", { ...values, __forms: { bp: true } })).toContain(
      "sf_bpmon.bpmon_start_date",
    );
  });

  it("limits BP Monitoring to 7 days and needs a reading each day", () => {
    const values = sample();
    const day = values.sf_bpmon_day[0];
    expect(fieldsOf("consultation", { ...values, sf_bpmon_day: Array(8).fill(day) })).toContain(
      "sf_bpmon_day",
    );
    const blank = {
      ...day,
      bpmon_am_systolic: undefined,
      bpmon_am_diastolic: undefined,
      bpmon_pm_systolic: undefined,
      bpmon_pm_diastolic: undefined,
    };
    expect(fieldsOf("consultation", { ...values, sf_bpmon_day: [blank] })).toContain(
      "sf_bpmon_day[0].bpmon_am_systolic",
    );
  });

  it("computes the Rapid HEADSSS flag", () => {
    const values = sample();
    const answers = Object.fromEntries(
      Object.keys(values.sf_adol_rapidheadsss)
        .filter((key) => /^rh_q\d{2}/.test(key))
        .map((key) => [key, "N"]),
    );
    const no = checker("consultation").check({
      ...values,
      sf_adol_rapidheadsss: { ...values.sf_adol_rapidheadsss, ...answers },
    });
    expect(no.body.sf_adol_rapidheadsss.rh_full_headsss_flag).toBe("N");
    const first = Object.keys(answers)[0];
    const yes = checker("consultation").check({
      ...values,
      sf_adol_rapidheadsss: { ...values.sf_adol_rapidheadsss, ...answers, [first]: "Y" },
    });
    expect(yes.body.sf_adol_rapidheadsss.rh_full_headsss_flag).toBe("Y");
  });

  it("computes age from the PhilHealth birth date", () => {
    const { body } = checker("consultation").check({
      ...sample(),
      __patient: { dob: "07/04/1990", sex: "F" },
    });
    expect(body.soap.patient_age).toBe("36 YR(S), 3 MO(S), 19 DAY(S)");
    expect(body.__patient).toBeUndefined();
  });
});

describe("Diagnostic Request", () => {
  it("refuses the same test twice", () => {
    const values = validSample("diagnostic_request");
    const row = values.diagrequest[0];
    values.diagrequest = [row, { ...row }];
    expect(fieldsOf("diagnostic_request", values)).toContain("diagrequest[1].diagnostic_code");
  });
});

describe("Diagnostic Results", () => {
  const row = (overrides = {}) => ({
    result_transaction_no: "LH123456782026102400001",
    diagnostic_code: "7",
    test_status: "01",
    test_lab_loc: "01",
    test_exam_date: "10/22/2026",
    test_remarks: "",
    fbs: { fbs_results_mg_dl: 90, fbs_interp: "" },
    cbc: { cbc_hematocrit: 40 },
    ...overrides,
  });
  const build = (item: object) => ({ ...validSample("diagnostic_results"), diagresult_item: [item] });

  it("sends only the result group for the test", () => {
    const { body } = checker("diagnostic_results").check(build(row()));
    expect(body.diagresult_item[0].fbs).toBeDefined();
    expect(body.diagresult_item[0].cbc).toBeUndefined();
  });

  it("sends no result group unless the test was done", () => {
    const { body } = checker("diagnostic_results").check(
      build(row({ test_status: "02", test_lab_loc: "", test_exam_date: "" })),
    );
    expect(body.diagresult_item[0].fbs).toBeUndefined();
  });

  it("refuses a result in both units", () => {
    const fields = fieldsOf(
      "diagnostic_results",
      build(row({ fbs: { fbs_results_mg_dl: 90, fbs_results_mmol_l: 5, fbs_interp: "" } })),
    );
    expect(fields).toContain("diagresult_item[0].fbs.fbs_results_mg_dl");
  });

  it("shows only the result group for the test", () => {
    const { showNested } = FORM_DEFINITIONS.diagnostic_results;
    const current = row();
    expect(showNested!(["diagresult_item", 0, "fbs"], current)).toBe(true);
    expect(showNested!(["diagresult_item", 0, "cbc"], current)).toBe(false);
    expect(showNested!(["diagresult_item", 0, "fbs"], { ...current, test_status: "02" })).toBe(false);
  });
});

describe("Medicine", () => {
  const entry = (overrides = {}) => ({
    instruction_quantity: "1 tablet",
    instruction_frequency: "TID",
    medicine_ext: { instruction_duration: "7 days" },
    ...overrides,
  });

  it("computes quantity as in the guide's sample", () => {
    expect(computeQuantity(entry())).toBe(21);
  });

  it("handles single doses and leaves as-needed to staff", () => {
    expect(computeQuantity(entry({ instruction_frequency: "STAT" }))).toBe(1);
    expect(computeQuantity(entry({ instruction_frequency: "PRN" }))).toBeNull();
    expect(computeQuantity(entry({ medicine_ext: { instruction_duration: "as needed" } }))).toBeNull();
  });

  it("computes the total price", () => {
    const { body } = checker("medicine").check(validSample("medicine"));
    expect(body.medicine[0].quantity).toBe(21);
    expect(body.medicine[0].total_amount_price).toBe(52.5);
  });

  it("drops library codes for a medicine not in the library", () => {
    const values = validSample("medicine");
    Object.assign(values.medicine[0], {
      drug_code: "",
      generic_code: "",
      strength_code: "",
      form_code: "",
      other_medicine: "Herbal syrup 60 mL",
    });
    expect(checker("medicine").check(values).issues).toEqual([]);
  });

  it("needs a library medicine or a description", () => {
    const values = validSample("medicine");
    values.medicine[0].drug_code = "";
    expect(fieldsOf("medicine", values)).toContain("medicine[0].drug_code");
  });
});

describe("Referral", () => {
  it("ties destinations to their required details", () => {
    const values = validSample("referral");
    values.referral.referral_type = "99";
    values.referral.referral_others_spec = "";
    expect(fieldsOf("referral", values)).toContain("referral.referral_others_spec");
  });

  it("maps errors to steps", () => {
    const { referral } = { referral: FORM_DEFINITIONS.referral };
    expect(referral.steps[stepIndexFor(referral, "physiciansignoff.physician_name")].id).toBe("physician");
  });
});
