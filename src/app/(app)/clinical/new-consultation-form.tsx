"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { ConsentField, TextField } from "@/components/ui/fields";
import type { ActionFailure } from "@/lib/action-result";
import { createConsultationAction } from "../uploads/actions";

export function NewConsultationForm() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const outcome = await createConsultationAction({ patient_pin: pin, consent });
      if (outcome.ok) router.push(`/clinical/${outcome.data.draftId}`);
      else setFailure(outcome);
    });
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-line bg-card p-5"
    >
      <h2 className="text-lg font-semibold text-navy">New consultation</h2>
      {failure && !failure.fieldErrors && (
        <ErrorSummary title={failure.title} body={failure.body} requestId={failure.requestId} />
      )}
      <TextField
        label="PIN"
        required
        placeholder="12 digits, no dashes"
        inputMode="numeric"
        maxLength={12}
        value={pin}
        error={failure?.fieldErrors?.patient_pin}
        onChange={(event) => setPin(event.target.value)}
      />
      <ConsentField
        checked={consent}
        onChange={setConsent}
        error={failure?.fieldErrors?.consent}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Start consultation"}
        </Button>
      </div>
    </form>
  );
}
