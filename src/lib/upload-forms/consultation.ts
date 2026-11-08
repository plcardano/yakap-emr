import { ageText, computeBmi } from "@/lib/fpe/derived";
import { HISTORY_TITLES } from "@/lib/fpe/form";
import type { ValidationIssue } from "@/lib/pcapi-spec/types";
import { MEASURE_AGE_RULES, missingIssues, requiredByAge } from "./checker";
import type { FormDefinition, FormToggle, Values } from "./types";

const VERIFICATION_FIELD = "soap.patient_verification_mode";

const SERVER_FILLED = [
  "soap.case_no",
  "soap.soap_transaction_no",
  "soap.created_by",
  "soap.pcu_transaction_code",
  "soap.one_time_pin",
  "soap.valid_id_type",
  "soap.valid_id_image",
];

const REQUIRED_OBJECTS = [
  "soap",
  "subjective",
  "allergy",
  "currentmed",
  "sochist",
  "sexhist",
  "ros",
  "pegensurvey",
  "pepert",
  "pemisc",
  "physiciansignoff",
  "diagnosis",
  "management",
];
const REQUIRED_ARRAYS = ["medhist", "immunizationhist", "famhist"];

const ROS_FIELDS = (ros: Values) =>
  Object.entries(ros).filter(([key]) => key.endsWith("_ros_id") || key.endsWith("_ros"));

function isFemale(values: Values) {
  return values.__patient?.sex !== "M";
}

export const SPECIFIC_FORMS: FormToggle[] = [
  {
    id: "obgyne",
    label: "OB-Gyn",
    groups: ["sf_obgyne_menshist", "sf_obgyne_preghist", "sf_obgyne_pe"],
    isAvailable: isFemale,
  },
  {
    id: "pedia",
    label: "Pediatric",
    groups: ["sf_pedia_immunization", "sf_pedia_vaccine", "sf_pedia_devmilestone"],
  },
  {
    id: "adol",
    label: "Adolescent",
    groups: ["sf_adol_immunization", "sf_adol_vaccine", "sf_adol_smr", "sf_adol_rapidheadsss"],
  },
  { id: "headsss", label: "Full HEADSSS", groups: ["sf_headsss"] },
  { id: "bp", label: "BP Monitoring", groups: ["sf_bpmon", "sf_bpmon_day"] },
];

const SPECIFIC_GROUPS = SPECIFIC_FORMS.flatMap((form) => form.groups);
const ARRAY_GROUPS = new Set(["sf_pedia_vaccine", "sf_pedia_devmilestone", "sf_adol_vaccine", "sf_bpmon_day"]);

function isEnabled(form: FormToggle, values: Values) {
  if (form.isAvailable && !form.isAvailable(values)) return false;
  const chosen = values.__forms?.[form.id];
  return chosen ?? form.groups.some((group) => values[group] !== undefined);
}

const CONSULTATION_AGE_RULES = [
  ...MEASURE_AGE_RULES,
  { path: "sochist.breastfeeding_status", applies: (age: { totalMonths: number }) => age.totalMonths <= 12 },
];

function ageRequired(values: Values) {
  return requiredByAge(
    CONSULTATION_AGE_RULES,
    values.__patient?.dob,
    values.soap?.consultation_date,
  );
}

const required = (field: string): ValidationIssue => ({
  field,
  issue: "validation_error",
  reason: "required",
});

function specificFormIssues(body: Values) {
  const issues: ValidationIssue[] = [];

  const usesOthers = ROS_FIELDS(body.ros ?? {}).some(([, value]) =>
    String(value).split(",").includes("X"),
  );
  if (usesOthers && !body.ros?.ros_other_spec) issues.push(required("ros.ros_other_spec"));

  if (body.sf_pedia_immunization && !body.sf_pedia_vaccine?.length) {
    issues.push(required("sf_pedia_vaccine"));
  }
  if (body.sf_adol_immunization && !body.sf_adol_vaccine?.length) {
    issues.push(required("sf_adol_vaccine"));
  }

  if (body.sf_bpmon) {
    const days: Values[] = body.sf_bpmon_day ?? [];
    if (days.length < 1 || days.length > 7) issues.push(required("sf_bpmon_day"));
    days.forEach((day, index) => {
      const hasAm = day.bpmon_am_systolic !== undefined && day.bpmon_am_diastolic !== undefined;
      const hasPm = day.bpmon_pm_systolic !== undefined && day.bpmon_pm_diastolic !== undefined;
      if (!hasAm && !hasPm) issues.push(required(`sf_bpmon_day[${index}].bpmon_am_systolic`));
    });
  }

  (body.sf_pedia_devmilestone as Values[] | undefined)?.forEach((row, index) => {
    const anyDanger = Object.entries(row).some(
      ([key, value]) => key.endsWith("_danger_signs") && value !== "",
    );
    if (!anyDanger && !row.milestone_at_par_flag) {
      issues.push(required(`sf_pedia_devmilestone[${index}].milestone_at_par_flag`));
    }
  });
  return issues;
}

export const CONSULTATION_DEFINITION: FormDefinition = {
  form: "consultation",
  title: "Consultation",
  steps: [
    { id: "encounter", title: "Encounter and verification", groups: ["soap", "guardian"] },
    {
      id: "subjective",
      title: "Reason and medical history",
      groups: ["subjective", "medhist", "hosphist", "surghist", "accidenthist"],
    },
    {
      id: "allergies",
      title: "Allergies, medicines and family history",
      groups: ["allergy", "currentmed", "immunizationhist", "famhist", "fhspecific"],
    },
    { id: "social", title: "Social and sexual history", groups: ["sochist", "sexhist"] },
    { id: "ros", title: "Review of systems", groups: ["ros"] },
    { id: "exam", title: "Physical exam", groups: ["pegensurvey", "pepert", "pemisc"] },
    {
      id: "plan",
      title: "Assessment and plan",
      groups: ["diagnosis", "management", "physiciansignoff"],
    },
    { id: "specific", title: "Specific forms", groups: SPECIFIC_GROUPS },
    { id: "review", title: "Review and submit", groups: [] },
  ],
  groupTitles: {
    ...HISTORY_TITLES,
    soap: "Encounter",
    subjective: "Reason for consultation",
    sexhist: "Sexual history",
    ros: "Review of systems",
    pepert: "Vital signs and measurements",
    pemisc: "Physical examination findings",
    diagnosis: "Assessment and diagnosis",
    management: "Plan and management",
    physiciansignoff: "Physician",
    sf_obgyne_menshist: "OB-Gyn: gynecological history",
    sf_obgyne_preghist: "OB-Gyn: obstetric history",
    sf_obgyne_pe: "OB-Gyn: examinations",
    sf_pedia_immunization: "Pediatric: routine immunization",
    sf_pedia_vaccine: "Pediatric: vaccines",
    sf_pedia_devmilestone: "Pediatric: developmental milestones",
    sf_adol_immunization: "Adolescent: routine immunization",
    sf_adol_vaccine: "Adolescent: vaccines",
    sf_adol_smr: "Adolescent: sexual maturity rating",
    sf_adol_rapidheadsss: "Adolescent: Rapid HEADSSS",
    sf_headsss: "Full HEADSSS assessment",
    sf_bpmon: "BP Monitoring: period",
    sf_bpmon_day: "BP Monitoring: days",
  },
  hidden: new Set([
    ...SERVER_FILLED,
    VERIFICATION_FIELD,
    "soap.patient_age",
    "pepert.bmi",
    "sf_adol_rapidheadsss.rh_full_headsss_flag",
  ]),
  readOnly: new Map([
    ["soap.patient_pin", "From the Selection Masterlist"],
    ["soap.patient_type", "From the Selection Masterlist"],
  ]),
  requiredObjects: REQUIRED_OBJECTS,
  requiredArrays: REQUIRED_ARRAYS,
  verification: { group: "soap", stepId: "encounter" },
  patientPin: (values) => String(values.soap?.patient_pin ?? ""),
  toggles: SPECIFIC_FORMS,
  prepare(input) {
    if (input.soap.patient_type === "DD") input.guardian ??= {};
    else delete input.guardian;

    for (const form of SPECIFIC_FORMS) {
      if (isEnabled(form, input)) {
        for (const group of form.groups) {
          input[group] ??= ARRAY_GROUPS.has(group) ? [] : {};
        }
      } else {
        for (const group of form.groups) delete input[group];
      }
    }

    if (input.__patient?.dob) {
      input.soap.patient_age = ageText(input.__patient.dob, input.soap.consultation_date);
    }
    const { weight, height, length } = input.pepert;
    const bmi = computeBmi(weight, height || length);
    if (bmi !== undefined) input.pepert.bmi = bmi;

    // Guide 4.6.2: Y when any Rapid HEADSSS question is answered Y.
    const rapid = input.sf_adol_rapidheadsss;
    if (rapid) {
      const anyYes = Object.entries(rapid).some(
        ([key, value]) => /^rh_q\d{2}/.test(key) && value === "Y",
      );
      rapid.rh_full_headsss_flag = anyYes ? "Y" : "N";
    }
  },
  extraIssues: (input, body) => [
    ...missingIssues(ageRequired(input), body),
    ...specificFormIssues(body),
  ],
  alsoRequired: ageRequired,
  visibleGroups(groups, values) {
    return groups.filter((group) => {
      if (group === "guardian") return values.soap?.patient_type === "DD";
      const form = SPECIFIC_FORMS.find((candidate) => candidate.groups.includes(group));
      return !form || isEnabled(form, values);
    });
  },
  derivedFields(stepId, values) {
    if (stepId === "encounter" && values.__patient?.dob) {
      const age = ageText(values.__patient.dob, values.soap?.consultation_date);
      if (age) return [{ label: "Patient age", value: age, source: "Computed from the date of birth" }];
    }
    if (stepId === "exam") {
      const bmi = computeBmi(values.pepert?.weight, values.pepert?.height || values.pepert?.length);
      if (bmi !== undefined) {
        return [{ label: "BMI", value: String(bmi), source: "Computed from weight and height" }];
      }
    }
    return [];
  },
  describePatient: (values) => values.__patient?.name ?? "Unnamed patient",
};
