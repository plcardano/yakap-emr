import type { Condition, FieldRule, LibraryCode, ValidationIssue } from "./types";

type Node = {
  isArray: boolean;
  rule?: FieldRule;
  children: Map<string, Node>;
};

type Json = Record<string, unknown>;
type Libraries = Record<string, LibraryCode[]>;

export function buildTree(rules: FieldRule[]) {
  const root: Node = { isArray: false, children: new Map() };
  for (const rule of rules) {
    let node = root;
    for (const segment of rule.path.split(".")) {
      const isArray = segment.endsWith("[]");
      const key = isArray ? segment.slice(0, -2) : segment;
      if (!node.children.has(key)) {
        node.children.set(key, { isArray, children: new Map() });
      }
      node = node.children.get(key)!;
    }
    node.rule = rule;
  }
  return root;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findAnywhere(value: unknown, field: string): unknown {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAnywhere(item, field);
      if (found !== undefined) return found;
    }
  } else if (isObject(value)) {
    if (value[field] !== undefined) return value[field];
    for (const child of Object.values(value)) {
      const found = findAnywhere(child, field);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

// Looks in the nearest data group first, then the rest of the request.
function lookup(field: string, scopes: Json[]) {
  for (let i = scopes.length - 1; i >= 0; i--) {
    if (scopes[i][field] !== undefined) return scopes[i][field];
  }
  return findAnywhere(scopes[0], field);
}

function holds(condition: Condition, scopes: Json[]) {
  const value = lookup(condition.field, scopes);
  if (value === undefined || value === null) return false;
  if (condition.op === "eq") return condition.values.includes(String(value));
  const selected = String(value).split(",").map((code) => code.trim());
  return condition.values.some((code) => selected.includes(code));
}

function isActive(rule: FieldRule, scopes: Json[]) {
  return rule.when?.every((condition) => holds(condition, scopes)) ?? false;
}

function isBlank(value: unknown) {
  return value === undefined || value === null || value === "";
}

/**
 * Builds a request body from form values: optional strings become "", empty
 * numbers and booleans are left out, null is never sent, and groups the form
 * did not supply are left out (guide 3.3).
 */
export function serialize(root: Node, input: Json): Json {
  const write = (node: Node, value: Json, scopes: Json[]): Json => {
    const output: Json = {};
    for (const [key, child] of node.children) {
      const current = value[key];

      if (child.rule) {
        const { rule } = child;
        const skip =
          rule.required === "conditional" &&
          rule.absentWhenInactive &&
          !isActive(rule, scopes);
        if (skip) continue;
        if (isBlank(current)) {
          if (rule.type === "string" && !rule.mayOmit) output[key] = "";
          continue;
        }
        if (rule.type === "number" && typeof current === "string") {
          output[key] = Number(current);
        } else if (rule.type === "string") {
          output[key] = String(current);
        } else {
          output[key] = current;
        }
        continue;
      }

      if (child.isArray) {
        if (Array.isArray(current) && current.length > 0) {
          output[key] = current.map((item: Json) =>
            write(child, item, [...scopes, item]),
          );
        }
      } else if (isObject(current) && Object.keys(current).length > 0) {
        output[key] = write(child, current, [...scopes, current]);
      }
    }
    return output;
  };
  return write(root, input, [input]);
}

function validDate(value: string, format: FieldRule["dateFormat"]) {
  const part = {
    "MM/DD/YYYY": /^(\d{2})\/(\d{2})\/(\d{4})$/,
    "MM/YYYY": /^(\d{2})\/(\d{4})$/,
    YYYY: /^\d{4}$/,
    "HH:MM": /^([01]\d|2[0-3]):[0-5]\d$/,
  }[format!].exec(value);
  if (!part) return false;
  if (format === "MM/YYYY") return Number(part[1]) >= 1 && Number(part[1]) <= 12;
  if (format === "MM/DD/YYYY") {
    const [month, day, year] = [Number(part[1]), Number(part[2]), Number(part[3])];
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  }
  return true;
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).length;
}

function checkValue(
  rule: FieldRule,
  value: unknown,
  libraries: Libraries,
  accreNo?: string,
): string | null {
  if (rule.type === "boolean") {
    if (typeof value !== "boolean") return "not_boolean";
    return rule.mustBeTrue && value !== true ? "must_be_true" : null;
  }

  if (rule.type === "number") {
    if (typeof value !== "number" || !Number.isFinite(value)) return "not_number";
    if (rule.whole && !Number.isInteger(value)) return "not_whole_number";
    if (rule.decimals !== undefined) {
      const decimals = String(value).split(".")[1]?.length ?? 0;
      if (decimals > rule.decimals) return "too_many_decimals";
    }
    if (rule.min !== undefined && value < rule.min) return "below_minimum";
    if (rule.max !== undefined && value > rule.max) return "above_maximum";
    return null;
  }

  if (typeof value !== "string") return "not_string";
  if (value === "") return null;

  if (rule.maxBytes !== undefined && byteLength(value) > rule.maxBytes) return "too_long";
  if (rule.maxChars !== undefined && value.length > rule.maxChars) return "too_long";
  if (rule.exactChars !== undefined && value.length !== rule.exactChars) return "wrong_length";
  if (rule.digits !== undefined && !new RegExp(`^\\d{${rule.digits}}$`).test(value)) {
    return "wrong_digits";
  }
  if (rule.dateFormat && !validDate(value, rule.dateFormat)) return "bad_date_format";
  if (rule.yesNo && value !== "Y" && value !== "N") return "not_yes_no";
  if (rule.allergy && !/^(N|Y - .+)$/.test(value)) return "bad_allergy_format";

  if (rule.recordPrefix) {
    const match = value.match(/^([A-Z])(.{9})(\d{8})(\d{5})$/);
    if (!match || match[1] !== rule.recordPrefix) return "bad_record_number";
    if (accreNo && match[2] !== accreNo) return "accre_no_mismatch";
  }

  if (rule.jpegMaxMb !== undefined) {
    if (!value.startsWith("/9j/")) return "not_jpeg";
    const bytes = Math.floor((value.length * 3) / 4);
    if (bytes > rule.jpegMaxMb * 1024 * 1024 + 3) return "image_too_large";
  }

  if (rule.library) {
    const codes = new Set(libraries[rule.library].map((entry) => entry.code));
    const selected = value.split(",");
    if (!selected.every((code) => codes.has(code))) return "unknown_library_code";
  }

  return null;
}

/** Applies the Data Dictionary checks. Returns one entry per failing field. */
export function validate(
  root: Node,
  body: Json,
  libraries: Libraries,
  options: { accreNo?: string } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const fail = (field: string, reason: string) =>
    issues.push({ field, issue: "validation_error", reason });

  const checkLeaf = (rule: FieldRule, value: unknown, field: string, scopes: Json[]) => {
    const active = rule.required === "conditional" && isActive(rule, scopes);
    const mustHaveValue = rule.required === "yes" || active;
    const mustBeAbsent =
      rule.required === "conditional" && rule.absentWhenInactive && !active;

    if (value === null) return fail(field, "null_not_accepted");
    if (mustBeAbsent) {
      if (value !== undefined) fail(field, "must_be_absent");
      return;
    }
    if (value === undefined) {
      if (mustHaveValue) fail(field, "required");
      else if (rule.type === "string" && !rule.mayOmit) fail(field, "must_be_present");
      return;
    }
    if (value === "") {
      if (mustHaveValue) fail(field, "required");
      else if (rule.type !== "string") fail(field, "empty_not_accepted");
      return;
    }
    if (rule.notWith && lookup(rule.notWith, scopes) !== undefined) {
      fail(field, "not_sent_together");
    }
    const reason = checkValue(rule, value, libraries, options.accreNo);
    if (reason) fail(field, reason);
  };

  const missingGroup = (node: Node, field: string, scopes: Json[]) => {
    for (const [key, child] of node.children) {
      const { rule } = child;
      if (rule?.absentWhenInactive && isActive(rule, scopes)) {
        fail(`${field}.${key}`, "required");
      }
    }
  };

  const walk = (node: Node, value: Json, prefix: string, scopes: Json[]) => {
    for (const [key, child] of node.children) {
      const field = prefix ? `${prefix}.${key}` : key;
      const current = value[key];

      if (child.rule) {
        checkLeaf(child.rule, current, field, scopes);
      } else if (child.isArray) {
        if (current === undefined) continue;
        if (!Array.isArray(current)) {
          fail(field, "not_array");
          continue;
        }
        current.forEach((item, index) => {
          if (isObject(item)) {
            walk(child, item, `${field}[${index}]`, [...scopes, item]);
          } else {
            fail(`${field}[${index}]`, "not_object");
          }
        });
      } else if (current === undefined) {
        missingGroup(child, field, scopes);
      } else if (isObject(current)) {
        walk(child, current, field, [...scopes, current]);
      } else {
        fail(field, "not_object");
      }
    }
  };

  walk(root, body, "", [body]);
  return issues;
}

/** Lists request fields the Data Dictionary does not define. */
export function unknownFields(root: Node, body: Json) {
  const unknown: string[] = [];
  const walk = (node: Node, value: Json, prefix: string) => {
    for (const [key, current] of Object.entries(value)) {
      const field = prefix ? `${prefix}.${key}` : key;
      const child = node.children.get(key);
      if (!child) {
        unknown.push(field);
      } else if (!child.rule && Array.isArray(current)) {
        current.forEach((item, i) => walk(child, item as Json, `${field}[${i}]`));
      } else if (!child.rule && isObject(current)) {
        walk(child, current, field);
      }
    }
  };
  walk(root, body, "");
  return unknown;
}
