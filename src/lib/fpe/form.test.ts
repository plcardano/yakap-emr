import { describe, expect, it } from "vitest";
import { librariesFor, rulesFor } from "@/lib/pcapi-spec";
import { validSample } from "../../../tests/fixtures/samples";
import {
  ageRequiredFields,
  createFpeChecker,
  FPE_STEPS,
  initialFpeValues,
  prepareFpeInput,
  stepIndexForField,
} from "./form";

const { check } = createFpeChecker(rulesFor("fpe"), librariesFor("fpe"));
const reasons = (values: object) =>
  Object.fromEntries(check(values).issues.map((issue) => [issue.field, issue.reason]));

describe("FPE form", () => {
  it("accepts the guide's sample", () => {
    expect(check(validSample("fpe")).issues).toEqual([]);
  });

  it("assigns every data group to one step", () => {
    const groups = FPE_STEPS.flatMap((step) => step.groups);
    const inRules = new Set(rulesFor("fpe").map((r) => r.path.split(/[.[]/)[0]));
    inRules.delete("consent");
    expect(new Set(groups)).toEqual(inRules);
    expect(new Set(groups).size).toBe(groups.length);
  });

  it("computes age and BMI", () => {
    const sample = validSample("fpe");
    delete sample.profile.patient_age;
    delete sample.pepert.bmi;
    const { body, issues } = check(sample);
    expect(issues).toEqual([]);
    expect(body.profile.patient_age).toBe("36 YR(S), 3 MO(S), 19 DAY(S)");
    expect(body.pepert.bmi).toBe(23.63);
  });

  it("leaves out women's health for a male patient", () => {
    const sample = validSample("fpe");
    sample.enlistment.patient_sex = "M";
    const { body, issues } = check(sample);
    expect(issues).toEqual([]);
    expect(body.gynehist).toBeUndefined();
    expect(body.preghist).toBeUndefined();
  });

  it("requires women's health for a female patient", () => {
    const sample = validSample("fpe");
    delete sample.gynehist;
    expect(reasons(sample)).toMatchObject({ "gynehist.menarche_flag": "required" });
  });

  it("requires the guardian for a dependent and removes it for a member", () => {
    const sample = validSample("fpe");
    sample.enlistment.patient_type = "DD";
    expect(reasons(sample)).toMatchObject({ "guardian.guardian_name": "required" });

    const member = validSample("fpe");
    member.guardian = { guardian_name: "Left over" };
    expect(check(member).body.guardian).toBeUndefined();
  });

  it("does not send a value whose condition no longer applies", () => {
    const sample = validSample("fpe");
    sample.sochist.vape_current_user = "N";
    sample.sochist.vape_current_years = 5;
    expect(check(sample).body.sochist.vape_current_years).toBeUndefined();
  });

  it("applies the age-based measurement rules", () => {
    const at = (dob: string) =>
      ageRequiredFields({
        enlistment: { patient_dob: dob },
        profile: { fpe_date: "10/23/2026" },
      });
    expect([...at("07/04/1990")].sort()).toEqual([
      "pepert.diastolic",
      "pepert.height",
      "pepert.systolic",
    ]);
    expect([...at("10/23/2025")].sort()).toEqual(["pepert.length", "pepert.mid_upper_arm_circ"]);
    expect([...at("10/23/2023")].sort()).toEqual([
      "pepert.height",
      "pepert.mid_upper_arm_circ",
    ]);
  });

  it("reports a required measurement missing for the patient's age", () => {
    const sample = validSample("fpe");
    delete sample.pepert.systolic;
    expect(reasons(sample)).toMatchObject({ "pepert.systolic": "required" });
  });

  it("requires a row in medical, immunization and family history", () => {
    const sample = validSample("fpe");
    sample.medhist = [];
    expect(reasons(sample)).toMatchObject({ medhist: "required" });
  });

  it("accepts the library's None codes for a patient with no history", () => {
    const sample = validSample("fpe");
    sample.medhist = [{ mdisease_code: "999" }];
    sample.immunizationhist = [{ immunization_code: "01" }];
    sample.famhist = [{ mdisease_code: "999" }];
    expect(check(sample).issues).toEqual([]);
  });

  it("drops blank optional rows", () => {
    const sample = validSample("fpe");
    sample.hosphist = [{ previous_hospitalization: "", date_previous_hospitalization: "" }];
    expect(prepareFpeInput(sample).hosphist).toEqual([]);
    expect(check(sample).body.hosphist).toBeUndefined();
  });

  it("reports empty required fields for a new form", () => {
    const issues = check(initialFpeValues({ patient_sex: "M" })).issues;
    expect(issues.length).toBeGreaterThan(20);
    expect(issues.some((issue) => issue.field === "enlistment.case_no")).toBe(false);
  });

  it("maps an error path to its step", () => {
    expect(FPE_STEPS[stepIndexForField("medhist[0].mhspecific.dialysis_type")].id).toBe("history");
    expect(FPE_STEPS[stepIndexForField("pepert.bmi")].id).toBe("exam");
  });
});
