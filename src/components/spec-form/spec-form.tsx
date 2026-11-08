"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AutoField,
  DateField,
  NumberField,
  SelectField,
  TextField,
  YesNo,
  type YesNoValue,
} from "@/components/ui/fields";
import { isActive, type SpecNode } from "@/lib/pcapi-spec/engine";
import type { FieldLabel, FieldRule, LibraryCode } from "@/lib/pcapi-spec/types";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Path = (string | number)[];

export type CodeOption = { value: string; label: string };

export type SpecFormConfig = {
  labels: Record<string, FieldLabel>;
  libraries: Record<string, LibraryCode[]>;
  groupTitles: Record<string, string>;
  /** Fields that are not shown. */
  hidden: Set<string>;
  /** Fields shown but not editable, with a note about where the value comes from. */
  readOnly: Map<string, string>;
  /** Fields required by a rule outside the Dictionary's structured conditions. */
  alsoRequired: Set<string>;
  errors: Record<string, string>;
  loadCodes: (library: string, parent?: string) => Promise<CodeOption[]>;
  onChange: (path: Path, value: unknown) => void;
};

const specPath = (path: Path) =>
  path.map((part) => (typeof part === "number" ? "[]" : part)).join(".").replaceAll(".[]", "[]");

const errorPath = (path: Path) =>
  path.map((part) => (typeof part === "number" ? `[${part}]` : part)).join(".").replaceAll(".[", "[");

const PSGC = /^(.*_)(province|municipality|barangay)_code$/;

const PSGC_LIBRARY: Record<string, string> = {
  province: "psgc_province",
  municipality: "psgc_municipality",
  barangay: "psgc_barangay",
};

const PSGC_PARENT: Record<string, string | undefined> = {
  municipality: "province",
  barangay: "municipality",
};

function PsgcField({
  name,
  value,
  group,
  label,
  required,
  error,
  config,
  path,
}: {
  name: string;
  value: string;
  group: Json;
  label: string;
  required: boolean;
  error?: string;
  config: SpecFormConfig;
  path: Path;
}) {
  const [, prefix, level] = name.match(PSGC)!;
  const parentLevel = PSGC_PARENT[level];
  const parent = parentLevel ? (group[`${prefix}${parentLevel}_code`] as string) : undefined;
  const [options, setOptions] = useState<CodeOption[]>([]);
  const { loadCodes } = config;

  useEffect(() => {
    let current = true;
    if (parentLevel && !parent) return;
    void loadCodes(PSGC_LIBRARY[level], parent).then((codes) => {
      if (current) setOptions(codes);
    });
    return () => {
      current = false;
    };
  }, [level, parent, parentLevel, loadCodes]);

  return (
    <SelectField
      label={label}
      required={required}
      options={parentLevel && !parent ? [] : options}
      value={value}
      error={error}
      onChange={(event) => {
        config.onChange(path, event.target.value);
        // A child code is meaningless once its parent changes.
        if (level === "province") {
          config.onChange([...path.slice(0, -1), `${prefix}municipality_code`], "");
        }
        if (level !== "barangay") {
          config.onChange([...path.slice(0, -1), `${prefix}barangay_code`], "");
        }
      }}
    />
  );
}

function AllergyField({
  label,
  value,
  error,
  onChange,
}: {
  label: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const has = value.startsWith("Y");
  const detail = has ? value.replace(/^Y( - )?/, "") : "";
  const choice: YesNoValue = value === "" ? null : has ? "Y" : "N";

  return (
    <div className="flex flex-col gap-2">
      <YesNo
        question={label}
        value={choice}
        error={error}
        onChange={(next) => onChange(next === "Y" ? "Y - " : "N")}
      />
      {has && (
        <TextField
          label="Specify"
          required
          value={detail}
          onChange={(event) => onChange(`Y - ${event.target.value}`)}
        />
      )}
    </div>
  );
}

function CheckboxList({
  label,
  required,
  options,
  value,
  error,
  onChange,
}: {
  label: string;
  required: boolean;
  options: CodeOption[];
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const selected = value ? value.split(",") : [];
  const toggle = (code: string) =>
    onChange(
      (selected.includes(code)
        ? selected.filter((item) => item !== code)
        : [...selected, code]
      ).join(","),
    );

  return (
    <fieldset className="md:col-span-2">
      <legend className="text-sm font-semibold text-ink">
        {label}
        {required && <span className="text-danger"> *</span>}
      </legend>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">
        {options.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={selected.includes(option.value)}
              onChange={() => toggle(option.value)}
            />
            {option.label}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}

function Field({
  node,
  name,
  path,
  group,
  scopes,
  config,
}: {
  node: SpecNode;
  name: string;
  path: Path;
  group: Json;
  scopes: Json[];
  config: SpecFormConfig;
}) {
  const rule = node.rule as FieldRule;
  const key = specPath(path);
  if (config.hidden.has(key)) return null;

  const active = isActive(rule, scopes);
  if (rule.required === "conditional" && rule.when && !active) return null;

  const label = config.labels[key]?.label ?? name;
  const unit = config.labels[key]?.unit;
  const raw = group[name];
  const value = raw === undefined || raw === null ? "" : String(raw);
  const required = rule.required === "yes" || active || config.alsoRequired.has(key);
  const error = config.errors[errorPath(path)];
  const set = (next: unknown) => config.onChange(path, next);

  const source = config.readOnly.get(key);
  if (source) {
    const coded = config.libraries[rule.library ?? ""]?.find((entry) => entry.code === value);
    return <AutoField label={label} value={coded?.description ?? (value || "—")} source={source} />;
  }

  if (rule.allergy) {
    return (
      <AllergyField
        label={required ? `${label} *` : label}
        value={value}
        error={error}
        onChange={set}
      />
    );
  }
  if (rule.yesNo) {
    return (
      <YesNo
        question={required ? `${label} *` : label}
        value={(value || null) as YesNoValue}
        onChange={set}
        error={error}
      />
    );
  }
  if (PSGC.test(name)) {
    return (
      <PsgcField
        {...{ name, value, group, label, required, error, config, path }}
      />
    );
  }
  if (rule.library) {
    const options = (config.libraries[rule.library] ?? []).map((entry) => ({
      value: entry.code,
      label: entry.description,
    }));
    if (rule.multiple) {
      return (
        <CheckboxList
          {...{ label, required, options, value, error }}
          onChange={set}
        />
      );
    }
    return (
      <SelectField
        {...{ label, required, options, value, error }}
        optional={!required}
        onChange={(event) => set(event.target.value)}
      />
    );
  }
  if (rule.dateFormat === "MM/DD/YYYY") {
    return (
      <DateField
        {...{ label, required, value, error }}
        optional={!required}
        onChange={(event) => set(event.target.value)}
      />
    );
  }
  if (rule.type === "number") {
    return (
      <NumberField
        {...{ label, required, value, error, unit }}
        optional={!required}
        step="any"
        onChange={(event) => set(event.target.value)}
      />
    );
  }
  return (
    <TextField
      {...{ label, required, value, error }}
      optional={!required}
      placeholder={rule.dateFormat}
      onChange={(event) => set(event.target.value)}
    />
  );
}

function Fields({
  node,
  path,
  value,
  scopes,
  config,
}: {
  node: SpecNode;
  path: Path;
  value: Json;
  scopes: Json[];
  config: SpecFormConfig;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[...node.children].map(([name, child]) => {
        const childPath = [...path, name];
        if (child.rule) {
          return (
            <Field
              key={name}
              node={child}
              name={name}
              path={childPath}
              group={value}
              scopes={scopes}
              config={config}
            />
          );
        }
        const nested = (value[name] ?? {}) as Json;
        return (
          <div key={name} className="md:col-span-2">
            <Fields
              node={child}
              path={childPath}
              value={nested}
              scopes={[...scopes, nested]}
              config={config}
            />
          </div>
        );
      })}
    </div>
  );
}

export function SpecGroup({
  tree,
  group,
  values,
  config,
}: {
  tree: SpecNode;
  group: string;
  values: Json;
  config: SpecFormConfig;
}) {
  const node = tree.children.get(group)!;
  const title = config.groupTitles[group] ?? group;
  const groupError = config.errors[group];

  const content = useMemo(() => {
    if (!node.isArray) {
      const value = (values[group] ?? {}) as Json;
      return (
        <Fields
          node={node}
          path={[group]}
          value={value}
          scopes={[values, value]}
          config={config}
        />
      );
    }
    const rows = (values[group] ?? []) as Json[];
    return (
      <div className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <div key={index} className="rounded-lg border border-line p-4">
            <Fields
              node={node}
              path={[group, index]}
              value={row}
              scopes={[values, row]}
              config={config}
            />
            <div className="mt-2 text-right">
              <Button
                variant="link"
                onClick={() =>
                  config.onChange(
                    [group],
                    rows.filter((_, position) => position !== index),
                  )
                }
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        <div>
          <Button variant="outline" onClick={() => config.onChange([group], [...rows, {}])}>
            Add entry
          </Button>
        </div>
      </div>
    );
  }, [node, group, values, config]);

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-lg font-semibold text-navy">{title}</h3>
      {groupError && <p className="text-xs text-danger">Add at least one entry.</p>}
      {content}
    </section>
  );
}
