"use client";

import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { ConsentField, DateField, TextField } from "@/components/ui/fields";
import { StatusChip } from "@/components/ui/status-chip";
import type { ActionFailure } from "@/lib/action-result";
import type { SelectionData } from "@/server/pcapi/services";
import type { VerificationMode } from "@/server/verification/evidence";
import { evidenceAction, submitSelectionAction } from "./actions";
import { MODE_LABELS } from "./mode-labels";

export function SelectionForm({ today }: { today: string }) {
  const [pin, setPin] = useState("");
  const [date, setDate] = useState(today);
  const [modes, setModes] = useState<VerificationMode[] | null>(null);
  const [mode, setMode] = useState<VerificationMode | "">("");
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [receipt, setReceipt] = useState<SelectionData | null>(null);
  const [pending, startTransition] = useTransition();

  function findEvidence() {
    setFailure(null);
    if (!/^\d{12}$/.test(pin)) {
      setFailure({
        ok: false,
        title: "Some details need correcting",
        fieldErrors: { patient_pin: "Enter exactly 12 digits, with no dashes or spaces." },
      });
      return;
    }
    startTransition(async () => {
      const found = await evidenceAction(pin);
      setModes(found);
      setMode(found[0] ?? "");
    });
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const outcome = await submitSelectionAction({
        patient_pin: pin,
        selection_date: date,
        mode,
        consent,
      });
      if (outcome.ok) setReceipt(outcome.data);
      else setFailure(outcome);
    });
  }

  function restart() {
    setPin("");
    setDate(today);
    setModes(null);
    setMode("");
    setConsent(false);
    setFailure(null);
    setReceipt(null);
  }

  if (receipt) {
    return (
      <section className="flex max-w-xl flex-col gap-3 rounded-xl border border-line bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xl font-bold text-navy">Selection recorded</h2>
          <StatusChip tone="success" text={receipt.selection.status} />
        </div>
        <dl className="text-sm">
          <div className="flex justify-between gap-4 border-b border-line py-2">
            <dt className="text-muted">PIN</dt>
            <dd className="font-semibold">{receipt.patient_pin}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-line py-2">
            <dt className="text-muted">Transaction no.</dt>
            <dd className="break-all font-semibold">{receipt.selection.transaction_no}</dd>
          </div>
          <div className="flex justify-between gap-4 py-2">
            <dt className="text-muted">Selection date</dt>
            <dd className="font-semibold">{receipt.selection.date}</dd>
          </div>
        </dl>
        <div className="flex flex-wrap gap-3">
          <ButtonLink href="/fpe">Go to First Patient Encounter</ButtonLink>
          <Button variant="outline" onClick={restart}>
            New selection
          </Button>
        </div>
      </section>
    );
  }

  const errors = failure?.fieldErrors;

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-line bg-card p-5"
    >
      {failure && !errors && (
        <ErrorSummary title={failure.title} body={failure.body} requestId={failure.requestId} />
      )}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <TextField
            label="PIN"
            required
            placeholder="12 digits, no dashes"
            inputMode="numeric"
            maxLength={12}
            value={pin}
            error={errors?.patient_pin}
            onChange={(event) => {
              setPin(event.target.value);
              setModes(null);
            }}
          />
        </div>
        <Button variant="outline" disabled={pending} onClick={findEvidence}>
          Continue
        </Button>
      </div>

      {modes && modes.length === 0 && (
        <div className="flex flex-col items-start gap-2 rounded-md bg-warning-soft p-3 text-sm text-warning">
          <p>This patient has not been verified today. Verify the patient first.</p>
          <ButtonLink variant="outline" href="/verification">
            Verify patient
          </ButtonLink>
        </div>
      )}

      {modes && modes.length > 0 && (
        <>
          <fieldset>
            <legend className="text-sm font-semibold text-ink">
              Verified today by <span className="text-danger">*</span>
            </legend>
            <div className="mt-1 flex flex-col gap-1">
              {modes.map((option) => (
                <label key={option} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="mode"
                    checked={mode === option}
                    onChange={() => setMode(option)}
                  />
                  {MODE_LABELS[option]}
                </label>
              ))}
            </div>
            {errors?.mode && <p className="text-xs text-danger">{errors.mode}</p>}
          </fieldset>
          <DateField
            label="Selection date"
            required
            value={date}
            error={errors?.selection_date}
            onChange={(event) => setDate(event.target.value)}
          />
          <ConsentField checked={consent} onChange={setConsent} error={errors?.consent} />
          <div className="flex justify-end">
            <Button type="submit" disabled={pending}>
              {pending ? "Submitting…" : "Record selection"}
            </Button>
          </div>
        </>
      )}
    </form>
  );
}
