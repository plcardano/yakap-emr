"use client";

import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

type FieldProps = {
  label: string;
  error?: string;
  /** Adds "(optional)" after the label. */
  optional?: boolean;
  required?: boolean;
};

const CONTROL =
  "w-full rounded-md border bg-card px-3 py-2 text-sm text-ink placeholder:text-muted focus:outline-2 focus:outline-primary disabled:bg-surface";

function controlClass(error?: string) {
  return `${CONTROL} ${error ? "border-danger" : "border-line"}`;
}

function a11y(id: string, error?: string) {
  return {
    id,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? `${id}-error` : undefined,
  };
}

function Field({
  id,
  label,
  error,
  optional,
  required,
  children,
}: FieldProps & { id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-ink">
        {label}
        {required && <span className="text-danger"> *</span>}
        {optional && <span className="font-normal text-muted"> (optional)</span>}
      </label>
      {children}
      {error && (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = FieldProps & Omit<InputHTMLAttributes<HTMLInputElement>, "required">;

export function TextField({ label, error, optional, required, ...input }: InputProps) {
  const id = useId();
  return (
    <Field {...{ id, label, error, optional, required }}>
      <input {...input} {...a11y(id, error)} className={controlClass(error)} />
    </Field>
  );
}

/** Dates are MM/DD/YYYY in every PCAPI request (guide 3.7). */
export function DateField(props: InputProps) {
  return (
    <TextField
      placeholder="MM/DD/YYYY"
      inputMode="numeric"
      maxLength={10}
      pattern="\d{2}/\d{2}/\d{4}"
      {...props}
    />
  );
}

export function NumberField({
  label,
  error,
  optional,
  required,
  unit,
  ...input
}: InputProps & { unit?: string }) {
  const id = useId();
  return (
    <Field {...{ id, label, error, optional, required }}>
      <div className="flex items-center gap-2">
        <input type="number" {...input} {...a11y(id, error)} className={controlClass(error)} />
        {unit && <span className="text-sm text-muted">{unit}</span>}
      </div>
    </Field>
  );
}

export function SelectField({
  label,
  error,
  optional,
  required,
  options,
  placeholder = "Select",
  ...select
}: FieldProps &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "required"> & {
    options: { value: string; label: string }[];
    placeholder?: string;
  }) {
  const id = useId();
  return (
    <Field {...{ id, label, error, optional, required }}>
      <select {...select} {...a11y(id, error)} className={controlClass(error)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function TextAreaField({
  label,
  error,
  optional,
  required,
  ...textarea
}: FieldProps & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "required">) {
  const id = useId();
  return (
    <Field {...{ id, label, error, optional, required }}>
      <textarea {...textarea} {...a11y(id, error)} className={controlClass(error)} />
    </Field>
  );
}

export function AutoField({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold text-ink">{label}</span>
      <span className="rounded-md bg-surface px-3 py-2 text-sm text-ink">{value}</span>
      <span className="text-xs text-muted">{source}</span>
    </div>
  );
}

/** Consent must be recorded before patient data is sent (guide 3.5). */
export function ConsentField({
  checked,
  onChange,
  error,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>
          The patient gave explicit consent to process their personal and health information
          under the Data Privacy Act of 2012.
        </span>
      </label>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export type YesNoValue = "Y" | "N" | null;

/** Yes or No fields are sent as "Y" and "N" (Data Dictionary note 4). */
export function YesNo({
  question,
  value,
  onChange,
  error,
}: {
  question: string;
  value: YesNoValue;
  onChange: (value: "Y" | "N") => void;
  error?: string;
}) {
  const name = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-semibold text-ink">{question}</legend>
      <div className="mt-1 flex gap-4">
        {(["Y", "N"] as const).map((option) => (
          <label key={option} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {option === "Y" ? "Yes" : "No"}
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}
