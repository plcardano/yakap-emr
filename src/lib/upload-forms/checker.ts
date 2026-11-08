import { buildTree, serialize, validate } from "@/lib/pcapi-spec/engine";
import type { FieldRule, LibraryCode, ValidationIssue } from "@/lib/pcapi-spec/types";
import { ageOn } from "@/lib/fpe/derived";
import type { FormDefinition, Values } from "./types";

function isBlankRow(row: Values): boolean {
  return Object.values(row).every((value) =>
    typeof value === "object" && value !== null
      ? isBlankRow(value)
      : value === "" || value === undefined || value === null,
  );
}

export function prepareInput(definition: FormDefinition, values: Values): Values {
  const input: Values = structuredClone(values);
  for (const group of definition.requiredObjects) input[group] ??= {};
  for (const [key, value] of Object.entries(input)) {
    if (Array.isArray(value) && !definition.requiredArrays.includes(key)) {
      input[key] = value.filter((row) => !isBlankRow(row));
    }
  }
  definition.prepare(input);
  return input;
}

export function createChecker(
  definition: FormDefinition,
  rules: FieldRule[],
  libraries: Record<string, LibraryCode[]>,
) {
  const tree = buildTree(rules);

  function check(values: Values, options: { accreNo?: string; includeHidden?: boolean } = {}) {
    const input = prepareInput(definition, values);
    const body = serialize(tree, input) as Values;
    const missingArrays: ValidationIssue[] = definition.requiredArrays
      .filter((group) => !body[group]?.length)
      .map((field) => ({ field, issue: "validation_error", reason: "required" }));
    const issues = [
      ...validate(tree, body, libraries, { accreNo: options.accreNo }),
      ...missingArrays,
      ...(definition.extraIssues?.(input, body) ?? []),
    ];

    const visible = (issue: ValidationIssue) => {
      if (issue.field === "consent") return false;
      const key = issue.field.replace(/\[\d+\]/g, "[]");
      return !definition.hidden.has(key) || key.endsWith("patient_verification_mode");
    };
    return { body, issues: options.includeHidden ? issues : issues.filter(visible) };
  }

  return { tree, check };
}

export function stepIndexFor(definition: FormDefinition, field: string) {
  const group = field.split(/[.[]/)[0];
  return definition.steps.findIndex((step) => step.groups.includes(group));
}

type AgeRule = {
  path: string;
  applies: (age: NonNullable<ReturnType<typeof ageOn>>) => boolean;
};

/** Measures the guide requires by age, shared by the FPE and Consultation. */
export const MEASURE_AGE_RULES: AgeRule[] = [
  { path: "pepert.systolic", applies: (age) => age.years >= 4 },
  { path: "pepert.diastolic", applies: (age) => age.years >= 4 },
  { path: "pepert.height", applies: (age) => age.years >= 2 },
  { path: "pepert.length", applies: (age) => age.totalMonths <= 24 },
];

export function requiredByAge(rules: AgeRule[], birth: unknown, on: unknown) {
  const age = ageOn(birth, on);
  if (!age) return new Set<string>();
  return new Set(rules.filter((rule) => rule.applies(age)).map((rule) => rule.path));
}

export function missingIssues(paths: Iterable<string>, body: Values) {
  const issues: ValidationIssue[] = [];
  for (const path of paths) {
    const [group, field] = path.split(".");
    if (body[group]?.[field] === undefined || body[group][field] === "") {
      issues.push({ field: path, issue: "validation_error", reason: "required" });
    }
  }
  return issues;
}
