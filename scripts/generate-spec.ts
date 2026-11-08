// Regenerates src/generated from the Data Dictionary and Library Reference.
// Run with: npm run spec:generate

import { mkdirSync, writeFileSync } from "node:fs";
import ExcelJS from "exceljs";
import type {
  Condition,
  DateFormat,
  FieldRule,
  LibraryCode,
  SpecId,
} from "../src/lib/pcapi-spec/types";

const DICTIONARY = "docs/spec/PCAPI_Data_Dictionary_YAKAP_2.0_rev20261026.xlsx";
const LIBRARY = "docs/spec/PCAPI_Library_Reference_YAKAP_2.0_rev20261026.xlsx";
const OUT = "src/generated";

function text(cell: ExcelJS.CellValue): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "object") {
    if ("result" in cell) return text(cell.result as ExcelJS.CellValue);
    if ("richText" in cell) return cell.richText.map((part) => part.text).join("");
    if ("text" in cell) return String(cell.text);
    if (cell instanceof Date) return cell.toISOString();
  }
  return String(cell);
}

function rowsOf(sheet: ExcelJS.Worksheet) {
  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    const values = row.values as ExcelJS.CellValue[];
    rows.push(values.slice(1).map(text));
  });
  return rows;
}

// Splits on " and " outside parentheses.
function splitAnd(clause: string) {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (let i = 0; i < clause.length; i++) {
    if (clause[i] === "(") depth++;
    if (clause[i] === ")") depth--;
    if (depth === 0 && clause.startsWith(" and ", i)) {
      parts.push(current);
      current = "";
      i += 4;
    } else {
      current += clause[i];
    }
  }
  parts.push(current);
  return parts;
}

function parseCondition(part: string): Condition | null {
  const match = part.trim().match(/^([a-z][a-z0-9_]*) (=|includes) (.+)$/);
  if (!match) return null;
  const [, field, op, raw] = match;
  const values = raw
    .replace(/\s*\([^)]*\)\s*$/, "")
    .split(" or ")
    .map((value) => value.replace(/\s*\([^)]*\)\s*$/, "").trim());
  if (values.some((value) => !value)) return null;
  return { field, op: op === "=" ? "eq" : "includes", values };
}

function parseWhen(source: string): Condition[] | null {
  const clause = source.match(/^Required (?:if|when) (.+?)(?:;|\.(?:\s|$)|$)/);
  if (!clause) return null;
  const conditions = splitAnd(clause[1]).map(parseCondition);
  return conditions.every(Boolean) ? (conditions as Condition[]) : null;
}

function parseRule(row: Record<string, string>): FieldRule {
  const checks = row["CHECKS"];
  const constraint = row["RULE (CONSTRAINT)"];
  const jsonType = row["API JSON TYPE"];
  const required = row["REQUIRED"].toLowerCase() as FieldRule["required"];
  const name = row["PARAMETER NAME"];

  const rule: FieldRule = {
    path: row["JSON PATH"],
    type: jsonType.startsWith("number")
      ? "number"
      : jsonType.startsWith("boolean")
        ? "boolean"
        : "string",
    required,
  };

  const number = (pattern: RegExp) => {
    const match = checks.match(pattern);
    return match ? Number(match[1]) : undefined;
  };

  rule.maxBytes = number(/String of at most (\d+) bytes/);
  rule.maxChars = number(/String of at most (\d+) characters/);
  rule.exactChars = number(/Exactly (\d+) characters/);

  const date =
    jsonType.match(/\((MM\/DD\/YYYY|MM\/YYYY|YYYY)\)/)?.[1] ??
    checks.match(/Format:? (MM\/DD\/YYYY|MM\/YYYY|YYYY|HH:MM)\b/)?.[1];
  if (date) rule.dateFormat = date as DateFormat;

  const precision = checks.match(/precision (\d+)(?:,(\d+))?/);
  if (precision) rule.decimals = Number(precision[2] ?? 0);
  rule.decimals ??= number(/Up to (\d+) decimal places/);

  const range = checks.match(/Value from ([\d.]+) to ([\d.]+)/);
  if (range) {
    rule.min = Number(range[1]);
    rule.max = Number(range[2]);
  }

  if (/Whole number only/.test(checks)) rule.whole = true;
  if (/"Y" or "N"\./.test(checks)) rule.yesNo = true;
  if (/"N", or "Y - "/.test(checks)) rule.allergy = true;
  if (/must be true/.test(checks)) rule.mustBeTrue = true;
  if (/the field may be left out/.test(checks)) rule.mayOmit = true;
  if (/Must be absent|Leave out when/i.test(`${checks} ${constraint}`)) {
    rule.absentWhenInactive = true;
  }

  rule.jpegMaxMb = number(/decodes to a JPEG of at most (\d+) MB/);
  rule.recordPrefix = checks.match(/Pattern ([A-Z])\+/)?.[1];
  rule.notWith = checks.match(/Not sent together with ([a-z0-9_]+)/)?.[1];
  rule.library = checks.match(/Active code of Library Reference: ([^;.]+)/)?.[1].trim();
  rule.external = row["VALID VALUES"].match(/^Refer to external library: ([^ (]+(?: category)?)/)?.[1];

  if (["patient_pin", "member_pin", "pin"].includes(name)) rule.digits = 12;

  if (required === "conditional") {
    const sentence = checks.match(/Required (?:if|when) [^]*?(?:\.(?:\s|$)|$)/)?.[0] ?? "";
    const source = /the rule in (CONSTRAINT|the description)/.test(sentence)
      ? constraint
      : sentence;
    const when = parseWhen(source);
    if (when) rule.when = when;
    else rule.manual = (constraint || sentence).slice(0, 300);
  }

  return Object.fromEntries(
    Object.entries(rule).filter(([, value]) => value !== undefined),
  ) as FieldRule;
}

const ANNEX_FORMS: Record<string, SpecId> = {
  "Annex A": "fpe",
  "Annex B": "consultation",
  "Annex C": "diagnostic_request",
  "Annex D": "diagnostic_results",
  "Annex E": "medicine",
  "Annex F": "referral",
};

const UPLOAD_FORMS = Object.values(ANNEX_FORMS);

function specIdsFor(annex: string, path: string): SpecId[] {
  if (ANNEX_FORMS[annex]) return [ANNEX_FORMS[annex]];
  const service = annex.match(/^Annex G \((.+)\)$/)?.[1] ?? "";
  if (service === "Token") return ["token"];
  if (service.startsWith("01")) {
    return [path === "liveness_authorization_id" ? "pcu_verify" : "pcu_start"];
  }
  if (service.startsWith("02")) return ["validator"];
  if (service.startsWith("03")) return ["empanelment"];
  if (service.startsWith("04")) return ["selection"];
  if (service.startsWith("05")) {
    if (["start_date", "end_date"].includes(path)) return ["masterlist_batch"];
    if (path === "consent") return ["masterlist_individual", "masterlist_batch"];
    return ["masterlist_individual"];
  }
  if (service.startsWith("06")) return UPLOAD_FORMS;
  if (service.startsWith("07")) return ["verification_code"];
  if (service.startsWith("08")) return ["availment_slip"];
  throw new Error(`Unmapped annex: ${annex}`);
}

async function generateRules() {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(DICTIONARY);
  const rows = rowsOf(book.getWorksheet("Validation Rules")!);
  const headerIndex = rows.findIndex((row) => row[0] === "NO.");
  const header = rows[headerIndex];

  const specs = {} as Record<SpecId, FieldRule[]>;
  let total = 0;
  for (const cells of rows.slice(headerIndex + 1)) {
    if (!cells[0]) continue;
    const row = Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""]));
    total++;
    // The Upload Status path parameter is not part of a request body.
    if (row["JSON PATH"].includes("(path)")) continue;
    const rule = parseRule(row);
    for (const id of specIdsFor(row["ANNEX"], row["JSON PATH"])) {
      specs[id] ??= [];
      if (!specs[id].some((existing) => existing.path === rule.path)) {
        specs[id].push(rule);
      }
    }
  }
  writeFileSync(`${OUT}/pcapi-rules.json`, `${JSON.stringify(specs, null, 1)}\n`);
  return { total, specs };
}

async function generateLibraries() {
  const book = new ExcelJS.Workbook();
  await book.xlsx.readFile(LIBRARY);
  const libraries: Record<string, LibraryCode[]> = {};
  for (const sheet of book.worksheets) {
    if (sheet.name === "Library Index" || sheet.name === "Revision History") continue;
    const rows = rowsOf(sheet);
    const headerIndex = rows.findIndex((row) => row[0]?.startsWith("LIBRARY CODE"));
    if (headerIndex < 0) throw new Error(`No header in ${sheet.name}`);
    const statusColumn = rows[headerIndex].findIndex((cell) =>
      cell.startsWith("LIBRARY STATUS"),
    );
    const codes: LibraryCode[] = [];
    for (const row of rows.slice(headerIndex + 1)) {
      // API-only values follow the coded rows and are never sent in a request.
      if (!row[0] || row[0].startsWith("<<") || row[0].startsWith("API-only")) break;
      if (row[statusColumn] === "1") {
        codes.push({ code: row[0], description: row[1] });
      }
    }
    libraries[sheet.name] = codes;
  }
  writeFileSync(`${OUT}/pcapi-libraries.json`, `${JSON.stringify(libraries, null, 1)}\n`);
  return libraries;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { total, specs } = await generateRules();
  const libraries = await generateLibraries();

  const all = Object.values(specs).flat();
  const conditional = all.filter((rule) => rule.required === "conditional");
  const missing = all.filter((rule) => rule.library && !libraries[rule.library]);
  console.log(`Rules read: ${total}`);
  console.log(`Specs: ${Object.keys(specs).length}`);
  console.log(`Libraries: ${Object.keys(libraries).length}`);
  console.log(
    `Conditional fields: ${conditional.length}, machine-checked: ${conditional.filter((r) => r.when).length}, form-level: ${conditional.filter((r) => r.manual).length}`,
  );
  if (missing.length) {
    throw new Error(`Unknown libraries: ${missing.map((r) => r.library).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
