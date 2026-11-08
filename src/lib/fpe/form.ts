import type { FieldRule, LibraryCode } from "@/lib/pcapi-spec/types";
import {
  createChecker,
  MEASURE_AGE_RULES,
  missingIssues,
  prepareInput,
  requiredByAge,
  stepIndexFor,
} from "@/lib/upload-forms/checker";
import type { FormDefinition, Values, WizardStepDefinition } from "@/lib/upload-forms/types";
import { ageText, computeBmi } from "./derived";

export type { Values, WizardStepDefinition };

export const FPE_STEPS: WizardStepDefinition[] = [
  { id: "patient", title: "Patient details", groups: ["enlistment", "guardian"] },
  { id: "encounter", title: "Encounter and verification", groups: ["profile"] },
  {
    id: "history",
    title: "Medical history",
    groups: ["medhist", "hosphist", "accidenthist", "surghist"],
  },
  {
    id: "allergies",
    title: "Allergies, medicines and family history",
    groups: ["allergy", "currentmed", "immunizationhist", "famhist", "fhspecific"],
  },
  { id: "social", title: "Social and lifestyle", groups: ["sochist"] },
  { id: "womens", title: "Women's health", groups: ["gynehist", "preghist"] },
  { id: "exam", title: "Physical exam", groups: ["pegensurvey", "pepert", "facilitator"] },
  { id: "review", title: "Review and submit", groups: [] },
];

export const HISTORY_TITLES: Record<string, string> = {
  guardian: "Parent or guardian",
  medhist: "Past medical history",
  hosphist: "Previous hospitalizations",
  accidenthist: "Previous accidents or injuries",
  surghist: "Previous surgeries",
  allergy: "Allergies",
  currentmed: "Current medications",
  immunizationhist: "Immunization history",
  famhist: "Family medical history",
  fhspecific: "Family history details",
  sochist: "Personal and social history",
  pegensurvey: "General survey",
};

export const GROUP_TITLES: Record<string, string> = {
  ...HISTORY_TITLES,
  enlistment: "Patient information",
  profile: "Encounter",
  gynehist: "OB-GYN history",
  preghist: "Pregnancy history",
  pepert: "Vital signs and measurements",
  facilitator: "Facilitator",
};

/** Set by the server when the form is submitted. */
export const SERVER_FILLED = new Set([
  "enlistment.case_no",
  "enlistment.enlist_transaction_no",
  "enlistment.accre_no",
  "enlistment.created_by",
  "profile.profile_transaction_no",
  "profile.pcu_transaction_code",
  "profile.one_time_pin",
  "profile.valid_id_type",
  "profile.valid_id_image",
]);

/** Filled from the Masterlist, shown read-only. */
export const FROM_MASTERLIST = new Set([
  "enlistment.patient_pin",
  "enlistment.patient_type",
  "enlistment.patient_fname",
  "enlistment.patient_mname",
  "enlistment.patient_lname",
  "enlistment.patient_extname",
  "enlistment.patient_sex",
  "enlistment.patient_dob",
  "enlistment.assignment_date",
  "enlistment.assignment_status",
]);

export const COMPUTED = new Set(["profile.patient_age", "pepert.bmi"]);

const VERIFICATION_FIELD = "profile.patient_verification_mode";

// Guide 4.6.1, Payload structure. A patient with no history sends the library's
// "None" code: 999 for disease, 01 for immunization.
const REQUIRED_OBJECTS = [
  "enlistment",
  "profile",
  "allergy",
  "currentmed",
  "sochist",
  "pegensurvey",
  "pepert",
  "facilitator",
];
const REQUIRED_ARRAYS = ["medhist", "immunizationhist", "famhist"];
const FEMALE_GROUPS = ["gynehist", "preghist"];

export function initialFpeValues(enlistment: Values): Values {
  return {
    ...Object.fromEntries(REQUIRED_OBJECTS.map((group) => [group, {}])),
    ...Object.fromEntries(REQUIRED_ARRAYS.map((group) => [group, [{}]])),
    enlistment,
  };
}

export function isFemale(values: Values) {
  return values.enlistment?.patient_sex === "F";
}

export function isDependent(values: Values) {
  return values.enlistment?.patient_type === "DD";
}

export function isStepApplicable(step: WizardStepDefinition, values: Values) {
  return step.id !== "womens" || isFemale(values);
}

const FPE_AGE_RULES = [
  ...MEASURE_AGE_RULES,
  {
    path: "pepert.mid_upper_arm_circ",
    applies: (age: { totalMonths: number; years: number }) =>
      age.totalMonths >= 6 && age.years <= 5,
  },
];

export function ageRequiredFields(values: Values) {
  return requiredByAge(FPE_AGE_RULES, values.enlistment?.patient_dob, values.profile?.fpe_date);
}

export const FPE_DEFINITION: FormDefinition = {
  form: "fpe",
  title: "First Patient Encounter",
  steps: FPE_STEPS,
  groupTitles: GROUP_TITLES,
  hidden: new Set([...SERVER_FILLED, ...COMPUTED, VERIFICATION_FIELD]),
  readOnly: new Map(
    [...FROM_MASTERLIST].map((path) => [path, "From the Selection Masterlist"]),
  ),
  requiredObjects: REQUIRED_OBJECTS,
  requiredArrays: REQUIRED_ARRAYS,
  verification: { group: "profile", stepId: "encounter" },
  patientPin: (values) => String(values.enlistment?.patient_pin ?? ""),
  prepare(input) {
    if (isFemale(input)) {
      input.gynehist ??= {};
      input.preghist ??= {};
    } else {
      for (const group of FEMALE_GROUPS) delete input[group];
    }
    if (isDependent(input)) input.guardian ??= {};
    else delete input.guardian;

    input.profile.patient_age = ageText(input.enlistment.patient_dob, input.profile.fpe_date);
    const { weight, height, length } = input.pepert;
    input.pepert.bmi = computeBmi(weight, height || length);
  },
  extraIssues: (input, body) => missingIssues(ageRequiredFields(input), body),
  alsoRequired: ageRequiredFields,
  isStepApplicable,
  visibleGroups: (groups, values) =>
    groups.filter((group) => group !== "guardian" || isDependent(values)),
  derivedFields(stepId, values) {
    if (stepId === "encounter") {
      const age = ageText(values.enlistment?.patient_dob, values.profile?.fpe_date);
      return age
        ? [{ label: "Patient age", value: age, source: "Computed from the date of birth" }]
        : [];
    }
    if (stepId === "exam") {
      const bmi = computeBmi(values.pepert?.weight, values.pepert?.height || values.pepert?.length);
      return bmi === undefined
        ? []
        : [{ label: "BMI", value: String(bmi), source: "Computed from weight and height" }];
    }
    return [];
  },
  describePatient(values) {
    const { patient_lname: last, patient_fname: first } = values.enlistment ?? {};
    return last ? `${last}, ${first ?? ""}`.trim() : "Unnamed patient";
  },
};

export function prepareFpeInput(values: Values) {
  return prepareInput(FPE_DEFINITION, values);
}

export function createFpeChecker(rules: FieldRule[], libraries: Record<string, LibraryCode[]>) {
  const { tree, check } = createChecker(FPE_DEFINITION, rules, libraries);
  return {
    tree,
    check: (values: Values, options: { accreNo?: string; includeServerFilled?: boolean } = {}) =>
      check(values, { accreNo: options.accreNo, includeHidden: options.includeServerFilled }),
  };
}

export function stepIndexForField(field: string) {
  return stepIndexFor(FPE_DEFINITION, field);
}
