"use client";

import { useState, useTransition } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { ConsentField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/modal";
import type { ActionFailure } from "@/lib/action-result";
import type { EmpanelmentTracker } from "@/server/empanelment/service";
import type { VerificationMode } from "@/server/verification/evidence";
import { MODE_LABELS } from "../selection/mode-labels";
import { recordAction } from "./actions";

type StepState = "done" | "todo" | "wait" | "failed";
type Step = { title: string; state: StepState; note: string };

const CIRCLE: Record<StepState, string> = {
  done: "bg-success text-white",
  todo: "border-2 border-primary text-primary",
  wait: "bg-warning text-white",
  failed: "bg-danger text-white",
};

const NOTE: Record<StepState, string> = {
  done: "text-success",
  todo: "text-primary",
  wait: "text-warning",
  failed: "text-danger",
};

function stepsOf({ validator, evidence, fpeUpload }: EmpanelmentTracker): Step[] {
  const assigned = Boolean(validator.patient_lname);
  const fpe: Pick<Step, "state" | "note"> =
    validator.fpe.status === "Y"
      ? { state: "done", note: "Accepted" }
      : fpeUpload === "queued" || fpeUpload === "processing"
        ? { state: "wait", note: "Processing" }
        : fpeUpload === "rejected"
          ? { state: "failed", note: "Rejected" }
          : { state: "todo", note: "To do" };

  return [
    {
      title: "Verification",
      ...(evidence.length
        ? { state: "done", note: "Done today" }
        : { state: "todo", note: "To do" }),
    },
    {
      title: "Selection",
      ...(assigned ? { state: "done", note: "Assigned" } : { state: "todo", note: "To do" }),
    },
    { title: "First Patient Encounter", ...fpe },
    {
      title: "Empanelment",
      ...(validator.empanelment.status === "Y"
        ? { state: "done", note: "Recorded" }
        : { state: "todo", note: "To do" }),
    },
  ];
}

function Tracker({ steps }: { steps: Step[] }) {
  return (
    <ol className="flex flex-1 items-start">
      {steps.map((step, index) => (
        <li key={step.title} className="relative flex flex-1 flex-col items-center text-center">
          {index > 0 && (
            <span
              aria-hidden
              className={`absolute top-3.5 right-1/2 h-0.5 w-full ${
                steps[index - 1].state === "done" ? "bg-success" : "bg-line"
              }`}
            />
          )}
          <span
            className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full bg-card text-xs font-bold ${CIRCLE[step.state]}`}
          >
            {step.state === "done" ? "✓" : step.state === "failed" ? "!" : index + 1}
          </span>
          <span className="mt-1 text-xs font-semibold text-navy">{step.title}</span>
          <span className={`text-xs font-semibold ${NOTE[step.state]}`}>{step.note}</span>
        </li>
      ))}
    </ol>
  );
}

function Action({
  steps,
  onRecord,
}: {
  steps: Step[];
  onRecord: () => void;
}) {
  const [verification, selection, fpe, empanelment] = steps;
  if (empanelment.state === "done") return null;
  if (selection.state !== "done") return <ButtonLink href="/selection">Go to Selection</ButtonLink>;
  if (fpe.state === "wait") {
    return <Button disabledReason="Waiting for the FPE to be accepted.">Record agreement</Button>;
  }
  if (fpe.state !== "done") return <ButtonLink href="/fpe">Go to FPE</ButtonLink>;
  if (verification.state !== "done") {
    return <ButtonLink href="/verification">Verify patient</ButtonLink>;
  }
  return <Button onClick={onRecord}>Record agreement</Button>;
}

export function TrackerRow({
  tracker,
  onUpdate,
}: {
  tracker: EmpanelmentTracker;
  onUpdate: (next: EmpanelmentTracker) => void;
}) {
  const { validator, evidence, referenceNo } = tracker;
  const steps = stepsOf(tracker);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<VerificationMode | "">(evidence[0] ?? "");
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setFailure(null);
    startTransition(async () => {
      const outcome = await recordAction({ patient_pin: validator.patient_pin, mode, consent });
      if (outcome.ok) {
        setOpen(false);
        onUpdate(outcome.data);
      } else {
        setFailure(outcome);
      }
    });
  }

  const name = validator.patient_lname
    ? `${validator.patient_lname}, ${validator.patient_fname ?? ""} ${validator.patient_mname ?? ""}`.trim()
    : "Beneficiary";
  const recorded = referenceNo ?? validator.empanelment.transaction_no;

  return (
    <section aria-label="Result" className="flex flex-col gap-3">
      {referenceNo && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          The Mutual Care Agreement was recorded. Reference no. {referenceNo}.
        </p>
      )}
      <div className="flex flex-col gap-4 rounded-xl border border-primary bg-card p-5 lg:flex-row lg:items-center">
        <div className="lg:w-56">
          <p className="font-bold text-navy">{name}</p>
          <p className="text-xs text-muted">PIN {validator.patient_pin}</p>
          {validator.patient_dob && (
            <p className="text-xs text-muted">Date of birth {validator.patient_dob}</p>
          )}
          <p className="text-xs text-muted">Effectivity year {validator.eff_year}</p>
        </div>
        <Tracker steps={steps} />
        <div className="flex flex-col items-start gap-1 lg:w-44 lg:items-end">
          <Action steps={steps} onRecord={() => setOpen(true)} />
          {validator.empanelment.status === "Y" && (
            <>
              <p className="text-xs text-muted">Reference no.</p>
              <p className="font-semibold text-navy">{recorded}</p>
              <p className="text-xs text-muted">{validator.empanelment.date}</p>
            </>
          )}
        </div>
      </div>

      <Modal
        open={open}
        title="Record the Mutual Care Agreement"
        onClose={() => setOpen(false)}
        footer={
          <>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={submit}>
              {pending ? "Recording…" : "Record agreement"}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          {failure && !failure.fieldErrors && (
            <ErrorSummary title={failure.title} body={failure.body} requestId={failure.requestId} />
          )}
          <fieldset>
            <legend className="font-semibold text-ink">
              Verified today by <span className="text-danger">*</span>
            </legend>
            <div className="mt-1 flex flex-col gap-1">
              {evidence.map((option) => (
                <label key={option} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="empanelment-mode"
                    checked={mode === option}
                    onChange={() => setMode(option)}
                  />
                  {MODE_LABELS[option]}
                </label>
              ))}
            </div>
            {failure?.fieldErrors?.mode && (
              <p className="text-xs text-danger">{failure.fieldErrors.mode}</p>
            )}
          </fieldset>
          <ConsentField
            checked={consent}
            onChange={setConsent}
            error={failure?.fieldErrors?.consent}
          />
        </div>
      </Modal>
    </section>
  );
}
