"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { ConsentField, DateField, TextField } from "@/components/ui/fields";
import type { ActionFailure } from "@/lib/action-result";
import { validateOtpAction } from "./actions";

export function OtpForm({ today }: { today: string }) {
  const initial = { patient_pin: "", one_time_pin: "", transaction_date: today };
  const [values, setValues] = useState(initial);
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [validFor, setValidFor] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const field = (name: keyof typeof initial) => ({
    name,
    value: values[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
    error: failure?.fieldErrors?.[name],
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setValidFor(null);
    startTransition(async () => {
      const outcome = await validateOtpAction({ ...values, consent });
      if (outcome.ok) setValidFor(outcome.data.transaction_date);
      else setFailure(outcome);
    });
  }

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
      {failure && !failure.fieldErrors && (
        <ErrorSummary title={failure.title} body={failure.body} requestId={failure.requestId} />
      )}
      {validFor && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          The code is valid for {validFor}. It can be used for this patient at this clinic on
          that date.
        </p>
      )}
      <p className="text-sm text-muted">Use the code PhilHealth issued to the patient.</p>
      <TextField
        label="PIN"
        required
        placeholder="12 digits, no dashes"
        inputMode="numeric"
        maxLength={12}
        {...field("patient_pin")}
      />
      <TextField
        label="Verification code"
        required
        maxLength={20}
        autoComplete="off"
        {...field("one_time_pin")}
      />
      <DateField label="Transaction date" required {...field("transaction_date")} />
      <ConsentField
        checked={consent}
        onChange={setConsent}
        error={failure?.fieldErrors?.consent}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Checking…" : "Validate code"}
        </Button>
      </div>
    </form>
  );
}
