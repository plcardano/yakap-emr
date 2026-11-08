"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { ConsentField, DateField, TextField } from "@/components/ui/fields";
import type { ActionFailure } from "@/lib/action-result";
import type { ValidatorData } from "@/server/pcapi/services";
import { lookupAction } from "./actions";
import { ValidatorResult } from "./validator-result";

const EMPTY = {
  patient_pin: "",
  first_name: "",
  middle_name: "",
  last_name: "",
  patient_dob: "",
  eff_year: "",
};

export function BeneficiaryLookup() {
  const [values, setValues] = useState(EMPTY);
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<ValidatorData | null>(null);
  const [pending, startTransition] = useTransition();

  const field = (name: keyof typeof EMPTY) => ({
    name,
    value: values[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
    error: failure?.fieldErrors?.[name],
  });

  function clear() {
    setValues(EMPTY);
    setConsent(false);
    setFailure(null);
    setResult(null);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setResult(null);
    startTransition(async () => {
      const outcome = await lookupAction({ ...values, consent });
      if (outcome.ok) setResult(outcome.data);
      else setFailure(outcome);
    });
  }

  const showSummary = failure && (!failure.fieldErrors || failure.requestId);

  return (
    <>
      <form
        onSubmit={submit}
        noValidate
        className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5"
      >
        <h2 className="text-lg font-semibold text-navy">Find a beneficiary</h2>
        <div className="max-w-sm">
          <TextField
            label="PhilHealth Identification No. (PIN)"
            placeholder="12 digits, no dashes"
            inputMode="numeric"
            maxLength={12}
            {...field("patient_pin")}
          />
        </div>
        <p className="text-sm text-muted">Or search by name and date of birth:</p>
        <div className="grid gap-3 md:grid-cols-4">
          <TextField label="First name" maxLength={30} {...field("first_name")} />
          <TextField label="Middle name" optional maxLength={30} {...field("middle_name")} />
          <TextField label="Last name" maxLength={30} {...field("last_name")} />
          <DateField label="Date of birth" {...field("patient_dob")} />
        </div>
        <div className="max-w-40">
          <TextField
            label="Effectivity year"
            optional
            placeholder="YYYY"
            inputMode="numeric"
            maxLength={4}
            {...field("eff_year")}
          />
        </div>
        <ConsentField
          checked={consent}
          onChange={setConsent}
          error={failure?.fieldErrors?.consent}
        />
        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={clear}>
            Clear
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "Checking…" : "Check status"}
          </Button>
        </div>
      </form>

      {showSummary && (
        <ErrorSummary
          title={failure.title}
          body={failure.body}
          requestId={failure.requestId}
          errors={failure.errors}
        />
      )}
      {result && <ValidatorResult data={result} />}
    </>
  );
}
