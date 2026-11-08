import { buildTree, serialize, validate } from "@/lib/pcapi-spec/engine";
import type { FieldRule, LibraryCode, ValidationIssue } from "@/lib/pcapi-spec/types";
import { ageOn, ageText, computeBmi } from "./derived";

export type Values = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export type WizardStepDefinition = { id: string; title: string; groups: string[] };

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

export const GROUP_TITLES: Record<string, string> = {
  enlistment: "Patient information",
  guardian: "Parent or guardian",
  profile: "Encounter",
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
  gynehist: "OB-GYN history",
  preghist: "Pregnancy history",
  pegensurvey: "General survey",
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

// Guide 4.6.1, Payload structure. A patient with no history sends the library's
// "None" code: 999 for disease, 01 for immunization.
const REQUIRED_OBJECT_GROUPS = [
  "enlistment",
  "profile",
  "allergy",
  "currentmed",
  "sochist",
  "pegensurvey",
  "pepert",
  "facilitator",
];
const REQUIRED_ARRAY_GROUPS = ["medhist", "immunizationhist", "famhist"];
const FEMALE_GROUPS = ["gynehist", "preghist"];

export function initialFpeValues(enlistment: Values): Values {
  return {
    ...Object.fromEntries(REQUIRED_OBJECT_GROUPS.map((group) => [group, {}])),
    ...Object.fromEntries(REQUIRED_ARRAY_GROUPS.map((group) => [group, [{}]])),
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

function isBlankRow(row: Values): boolean {
  return Object.values(row).every((value) =>
    typeof value === "object" && value !== null
      ? isBlankRow(value)
      : value === "" || value === undefined || value === null,
  );
}

/** Applies the computed values and leaves out what does not apply. */
export function prepareFpeInput(values: Values): Values {
  const input: Values = structuredClone(values);

  if (isFemale(input)) {
    input.gynehist ??= {};
    input.preghist ??= {};
  } else {
    for (const group of FEMALE_GROUPS) delete input[group];
  }
  if (isDependent(input)) input.guardian ??= {};
  else delete input.guardian;

  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value) && !REQUIRED_ARRAY_GROUPS.includes(key)) {
      input[key] = value.filter((row) => !isBlankRow(row));
    }
  }

  input.profile.patient_age = ageText(input.enlistment.patient_dob, input.profile.fpe_date);
  const { weight, height, length } = input.pepert;
  input.pepert.bmi = computeBmi(weight, height || length);
  return input;
}

type AgeRule = {
  field: string;
  applies: (age: NonNullable<ReturnType<typeof ageOn>>) => boolean;
};

// Conditional rules the Data Dictionary states in words.
const AGE_RULES: AgeRule[] = [
  { field: "systolic", applies: (age) => age.years >= 4 },
  { field: "diastolic", applies: (age) => age.years >= 4 },
  { field: "height", applies: (age) => age.years >= 2 },
  { field: "length", applies: (age) => age.totalMonths <= 24 },
  {
    field: "mid_upper_arm_circ",
    applies: (age) => age.totalMonths >= 6 && age.years <= 5,
  },
];

export function ageRequiredFields(values: Values) {
  const age = ageOn(values.enlistment?.patient_dob, values.profile?.fpe_date);
  if (!age) return new Set<string>();
  return new Set(
    AGE_RULES.filter((rule) => rule.applies(age)).map((rule) => `pepert.${rule.field}`),
  );
}

function formIssues(input: Values, body: Values): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (field: string) =>
    issues.push({ field, issue: "validation_error", reason: "required" });

  for (const path of ageRequiredFields(input)) {
    const [group, field] = path.split(".");
    if (body[group]?.[field] === undefined || body[group][field] === "") fail(path);
  }
  for (const group of REQUIRED_ARRAY_GROUPS) {
    if (!body[group]?.length) fail(group);
  }
  return issues;
}

export function createFpeChecker(rules: FieldRule[], libraries: Record<string, LibraryCode[]>) {
  const tree = buildTree(rules);

  /** Issues for everything the person filling the form can correct. */
  function check(values: Values, options: { accreNo?: string; includeServerFilled?: boolean } = {}) {
    const input = prepareFpeInput(values);
    const body = serialize(tree, input) as Values;
    const issues = [
      ...validate(tree, body, libraries, { accreNo: options.accreNo }),
      ...formIssues(input, body),
    ];
    return {
      body,
      issues: options.includeServerFilled
        ? issues
        : issues.filter(
            (issue) => !SERVER_FILLED.has(issue.field) && issue.field !== "consent",
          ),
    };
  }

  return { tree, check };
}

export function stepIndexForField(field: string) {
  const group = field.split(/[.[]/)[0];
  return FPE_STEPS.findIndex((step) => step.groups.includes(group));
}
