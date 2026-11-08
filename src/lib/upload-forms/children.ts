import resultGroups from "@/generated/pcapi-result-groups.json";
import type { ValidationIssue } from "@/lib/pcapi-spec/types";
import type { FormDefinition, Values } from "./types";

const PHYSICIAN = { physiciansignoff: "Physician" };
const describePatient = (values: Values) => values.__patient?.name ?? "Unnamed patient";
const REVIEW = { id: "review", title: "Review and submit", groups: [] };

const groupForCode = resultGroups as Record<string, string>;
const ALL_RESULT_GROUPS = new Set(Object.values(groupForCode));

export const DIAGNOSTIC_REQUEST_DEFINITION: FormDefinition = {
  form: "diagnostic_request",
  title: "Diagnostic Request",
  steps: [{ id: "tests", title: "Requested tests", groups: ["diagrequest"] }, REVIEW],
  groupTitles: { diagrequest: "Requested tests" },
  hidden: new Set([
    "diagrequest[].case_no",
    "diagrequest[].soap_transaction_no",
    "diagrequest[].request_transaction_no",
  ]),
  readOnly: new Map(),
  requiredObjects: [],
  requiredArrays: ["diagrequest"],
  prepare() {},
  extraIssues(_input, body) {
    const seen = new Set<string>();
    const issues: ValidationIssue[] = [];
    (body.diagrequest as Values[] | undefined)?.forEach((row, index) => {
      if (row.diagnostic_code && seen.has(row.diagnostic_code)) {
        issues.push({
          field: `diagrequest[${index}].diagnostic_code`,
          issue: "validation_error",
          reason: "duplicate_test",
        });
      }
      seen.add(row.diagnostic_code);
    });
    return issues;
  },
  describePatient,
};

export const DIAGNOSTIC_RESULTS_DEFINITION: FormDefinition = {
  form: "diagnostic_results",
  title: "Diagnostic Results",
  steps: [
    { id: "results", title: "Results", groups: ["diagnosticresult", "diagresult_item"] },
    { id: "physician", title: "Physician", groups: ["physiciansignoff"] },
    REVIEW,
  ],
  groupTitles: { diagnosticresult: "Results", diagresult_item: "Tests", ...PHYSICIAN },
  hidden: new Set([
    "diagnosticresult.case_no",
    "diagnosticresult.soap_transaction_no",
    "diagnosticresult.request_transaction_no",
    "diagresult_item[].result_transaction_no",
  ]),
  readOnly: new Map([["diagresult_item[].diagnostic_code", "From the Diagnostic Request"]]),
  requiredObjects: ["diagnosticresult", "physiciansignoff"],
  requiredArrays: ["diagresult_item"],
  fixedRows: new Set(["diagresult_item"]),
  showNested(path, row) {
    const name = String(path.at(-1));
    return (
      !ALL_RESULT_GROUPS.has(name) ||
      (row.test_status === "01" && groupForCode[row.diagnostic_code] === name)
    );
  },
  prepare(input) {
    for (const row of input.diagresult_item as Values[]) {
      const applicable = row.test_status === "01" ? groupForCode[row.diagnostic_code] : undefined;
      for (const group of ALL_RESULT_GROUPS) {
        if (group !== applicable) delete row[group];
      }
      if (applicable) row[applicable] ??= {};
    }
  },
  describePatient,
};

// Doses per day for each Instruction Frequency code. PRN cannot be computed.
const DOSES_PER_DAY: Record<string, number> = {
  OD: 1,
  BID: 2,
  TID: 3,
  QID: 4,
  Q4H: 6,
  Q6H: 4,
  Q8H: 3,
  Q12H: 2,
  HS: 1,
};

function leadingNumber(text: unknown) {
  const match = String(text ?? "").match(/^\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

/** Quantity = units per intake × frequency × duration (guide 4.6.5). */
export function computeQuantity(row: Values) {
  const units = leadingNumber(row.instruction_quantity);
  if (units === null) return null;
  if (row.instruction_frequency === "STAT") return units;
  const perDay = DOSES_PER_DAY[row.instruction_frequency];
  const days = leadingNumber(row.medicine_ext?.instruction_duration);
  return perDay === undefined || days === null ? null : units * perDay * days;
}

function withComputedAmounts(row: Values): Values {
  const quantity = computeQuantity(row) ?? row.quantity;
  const price = Number(row.actual_unit_price);
  const total =
    Number(quantity) > 0 && price > 0
      ? Math.round(Number(quantity) * price * 100) / 100
      : row.total_amount_price;
  return { ...row, quantity, total_amount_price: total };
}

export const MEDICINE_DEFINITION: FormDefinition = {
  form: "medicine",
  title: "Drugs and Medicines",
  steps: [
    { id: "medicines", title: "Medicines", groups: ["medicine"] },
    { id: "physician", title: "Physician", groups: ["physiciansignoff"] },
    REVIEW,
  ],
  groupTitles: { medicine: "Medicines", ...PHYSICIAN },
  hidden: new Set([
    "medicine[].case_no",
    "medicine[].soap_transaction_no",
    "medicine[].meds_transaction_no",
    "medicine[].total_amount_price",
  ]),
  readOnly: new Map(),
  requiredObjects: ["physiciansignoff"],
  requiredArrays: ["medicine"],
  derive: (values) => ({ ...values, medicine: values.medicine?.map(withComputedAmounts) }),
  prepare(input) {
    input.medicine = input.medicine.map((row: Values) => {
      const next = withComputedAmounts(row);
      next.medicine_ext ??= {};
      return next;
    });
  },
  describePatient,
};

export const REFERRAL_DEFINITION: FormDefinition = {
  form: "referral",
  title: "Referral Request",
  steps: [
    { id: "referral", title: "Referral", groups: ["referral"] },
    { id: "encounter", title: "Consultation details", groups: ["soap", "guardian"] },
    { id: "physician", title: "Physician", groups: ["physiciansignoff"] },
    REVIEW,
  ],
  groupTitles: {
    referral: "Referral",
    soap: "Consultation details",
    guardian: "Parent or guardian",
    ...PHYSICIAN,
  },
  hidden: new Set([
    "soap.case_no",
    "soap.soap_transaction_no",
    "soap.pcu_transaction_code",
    "referral.referral_transaction_no",
  ]),
  readOnly: new Map(
    [
      "soap.patient_type",
      "soap.patient_pin",
      "soap.patient_age",
      "soap.method_of_service_delivery",
      "soap.co_payment_flag",
      "soap.co_payment_date_payment",
      "soap.co_payment",
      "soap.co_payment_balance",
      "soap.consultation_date",
      "soap.consultation_time",
    ].map((path) => [path, "From the consultation"]),
  ),
  requiredObjects: ["soap", "referral", "physiciansignoff"],
  requiredArrays: [],
  prepare(input) {
    if (input.soap.patient_type === "DD") input.guardian ??= {};
    else delete input.guardian;
  },
  visibleGroups: (groups, values) =>
    groups.filter((group) => group !== "guardian" || values.soap?.patient_type === "DD"),
  describePatient,
};
