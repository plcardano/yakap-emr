"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { SpecGroup, type SpecFormConfig } from "@/components/spec-form/spec-form";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { AutoField, ConsentField } from "@/components/ui/fields";
import { WizardStepper, type StepState } from "@/components/ui/wizard-stepper";
import type { ActionFailure } from "@/lib/action-result";
import { ageText, computeBmi } from "@/lib/fpe/derived";
import {
  ageRequiredFields,
  COMPUTED,
  createFpeChecker,
  FPE_STEPS,
  FROM_MASTERLIST,
  GROUP_TITLES,
  isDependent,
  isStepApplicable,
  SERVER_FILLED,
  stepIndexForField,
  type Values,
} from "@/lib/fpe/form";
import { FALLBACK_REASON, REASON_COPY } from "@/lib/pcapi-messages";
import type { FieldLabel, FieldRule, LibraryCode } from "@/lib/pcapi-spec/types";
import type { VerificationMode } from "@/server/verification/evidence";
import { MODE_LABELS } from "../../selection/mode-labels";
import {
  deleteDraftAction,
  loadCodesAction,
  saveDraftAction,
  submitFpeAction,
} from "../actions";

const REVIEW = FPE_STEPS.length - 1;
const VERIFICATION_FIELD = "profile.patient_verification_mode";

function setIn(target: Values, path: (string | number)[], value: unknown): Values {
  const [head, ...rest] = path;
  const copy: Values = Array.isArray(target) ? [...target] : { ...target };
  copy[head] = rest.length === 0 ? value : setIn(copy[head] ?? {}, rest, value);
  return copy;
}

const HIDDEN = new Set([...SERVER_FILLED, ...COMPUTED, VERIFICATION_FIELD]);
const READ_ONLY = new Map(
  [...FROM_MASTERLIST].map((path) => [path, "From the Selection Masterlist"]),
);

export function FpeWizard({
  draftId,
  initialValues,
  initialStep,
  isCorrection,
  evidence,
  rules,
  labels,
  libraries,
}: {
  draftId: string;
  initialValues: Values;
  initialStep: number;
  isCorrection: boolean;
  evidence: VerificationMode[];
  rules: FieldRule[];
  labels: Record<string, FieldLabel>;
  libraries: Record<string, LibraryCode[]>;
}) {
  const router = useRouter();
  const { tree, check } = useMemo(() => createFpeChecker(rules, libraries), [rules, libraries]);
  const [values, setValues] = useState(initialValues);
  const [step, setStep] = useState(initialStep);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failedSteps, setFailedSteps] = useState<Set<number>>(new Set());
  const [visited, setVisited] = useState(initialStep);
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const top = useRef<HTMLDivElement>(null);

  const onChange = useCallback((path: (string | number)[], value: unknown) => {
    setValues((current) => setIn(current, path, value));
  }, []);

  const config: SpecFormConfig = useMemo(
    () => ({
      labels,
      libraries,
      groupTitles: GROUP_TITLES,
      hidden: HIDDEN,
      readOnly: READ_ONLY,
      alsoRequired: ageRequiredFields(values),
      errors,
      loadCodes: loadCodesAction,
      onChange,
    }),
    [labels, libraries, values, errors, onChange],
  );

  function errorsByField(issues: { field: string; reason: string }[]) {
    return Object.fromEntries(
      issues.map(({ field, reason }) => [field, REASON_COPY[reason] ?? FALLBACK_REASON]),
    );
  }

  function goTo(next: number) {
    setErrors({});
    setFailure(null);
    setStep(next);
    setVisited((current) => Math.max(current, next));
    top.current?.scrollIntoView();
    startTransition(async () => {
      await saveDraftAction(draftId, values, next);
    });
  }

  function nextApplicable(from: number, direction: 1 | -1) {
    let index = from + direction;
    while (FPE_STEPS[index] && !isStepApplicable(FPE_STEPS[index], values)) index += direction;
    return index;
  }

  function issuesForStep(index: number) {
    const groups = FPE_STEPS[index].groups;
    return check(values).issues.filter((issue) =>
      groups.includes(issue.field.split(/[.[]/)[0]),
    );
  }

  function next() {
    const issues = issuesForStep(step);
    if (issues.length) {
      setErrors(errorsByField(issues));
      setFailedSteps((current) => new Set(current).add(step));
      top.current?.scrollIntoView();
      return;
    }
    setFailedSteps((current) => {
      const copy = new Set(current);
      copy.delete(step);
      return copy;
    });
    goTo(nextApplicable(step, 1));
  }

  function showFailure(outcome: ActionFailure) {
    const fields = outcome.fieldErrors ?? {};
    const failed = new Set(
      Object.keys(fields)
        .map(stepIndexForField)
        .filter((index) => index >= 0),
    );
    setFailure(outcome);
    setErrors(fields);
    setFailedSteps(failed);
    if (failed.size) setStep(Math.min(...failed));
    top.current?.scrollIntoView();
  }

  function submit() {
    setFailure(null);
    setErrors({});
    startTransition(async () => {
      const outcome = await submitFpeAction({ draftId, values, consent });
      if (outcome.ok) {
        router.push("/fpe");
        return;
      }
      showFailure(outcome);
    });
  }

  const stepStates = FPE_STEPS.map((definition, index) => {
    let state: StepState = "upcoming";
    if (!isStepApplicable(definition, values)) state = "not-applicable";
    else if (index === step) state = "current";
    else if (failedSteps.has(index)) state = "error";
    else if (index < visited) state = "done";
    return { title: definition.title, state };
  });

  const current = FPE_STEPS[step];
  const groups = current.groups.filter((group) => group !== "guardian" || isDependent(values));
  const patient = `${values.enlistment?.patient_lname ?? ""}, ${values.enlistment?.patient_fname ?? ""}`;
  const showSummary = failure && (!failure.fieldErrors || failure.requestId);
  const bmi = computeBmi(values.pepert?.weight, values.pepert?.height || values.pepert?.length);
  const age = ageText(values.enlistment?.patient_dob, values.profile?.fpe_date);

  return (
    <div ref={top} className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-navy">First Patient Encounter</h1>
          <p className="mt-1 text-muted">
            {patient}
            {isCorrection && " · Correcting a rejected submission"}
          </p>
        </div>
        <ButtonLink variant="outline" href="/fpe">
          Exit
        </ButtonLink>
      </header>

      <div className="flex flex-col gap-5 lg:flex-row">
        <aside className="h-fit shrink-0 rounded-xl border border-line bg-card p-3 lg:w-64">
          <WizardStepper
            steps={stepStates}
            onSelect={(index) => {
              setErrors({});
              setStep(index);
            }}
          />
        </aside>

        <section className="flex min-w-0 flex-1 flex-col gap-6 rounded-xl border border-line bg-card p-5">
          <h2 className="text-xl font-bold text-navy">{current.title}</h2>

          {showSummary && (
            <ErrorSummary
              title={failure.title}
              body={failure.body}
              requestId={failure.requestId}
              errors={failure.errors}
            />
          )}

          {current.id === "encounter" && (
            <fieldset>
              <legend className="text-sm font-semibold text-ink">
                Patient verified today by <span className="text-danger">*</span>
              </legend>
              {evidence.length === 0 ? (
                <p className="mt-1 rounded-md bg-warning-soft p-3 text-sm text-warning">
                  This patient has not been verified today.{" "}
                  <a className="underline" href="/verification">
                    Verify the patient
                  </a>
                  , then return to this draft.
                </p>
              ) : (
                <div className="mt-1 flex flex-col gap-1">
                  {evidence.map((mode) => (
                    <label key={mode} className="flex items-center gap-2 text-sm">
                      <input
                        type="radio"
                        name="verification-mode"
                        checked={values.profile?.patient_verification_mode === mode}
                        onChange={() => onChange(["profile", "patient_verification_mode"], mode)}
                      />
                      {MODE_LABELS[mode]}
                    </label>
                  ))}
                </div>
              )}
              {errors[VERIFICATION_FIELD] && (
                <p className="text-xs text-danger">Choose how the patient was verified today.</p>
              )}
            </fieldset>
          )}

          {groups.map((group) => (
            <SpecGroup key={group} tree={tree} group={group} values={values} config={config} />
          ))}

          {current.id === "encounter" && age && (
            <AutoField label="Patient age" value={age} source="Computed from the date of birth" />
          )}
          {current.id === "exam" && bmi !== undefined && (
            <AutoField label="BMI" value={String(bmi)} source="Computed from weight and height" />
          )}

          {current.id === "review" && (
            <div className="flex flex-col gap-4">
              <ul className="flex flex-col gap-1 text-sm">
                {FPE_STEPS.slice(0, REVIEW)
                  .filter((definition) => isStepApplicable(definition, values))
                  .map((definition) => {
                    const count = definition.groups.reduce(
                      (total, group) =>
                        total +
                        check(values).issues.filter(
                          (issue) => issue.field.split(/[.[]/)[0] === group,
                        ).length,
                      0,
                    );
                    return (
                      <li key={definition.id} className="flex justify-between gap-3">
                        <span>{definition.title}</span>
                        <span className={count ? "text-danger" : "text-success"}>
                          {count ? `${count} to fix` : "Complete"}
                        </span>
                      </li>
                    );
                  })}
              </ul>
              <ConsentField
                checked={consent}
                onChange={setConsent}
                error={errors.consent}
              />
            </div>
          )}

          <div className="flex flex-wrap justify-between gap-3 border-t border-line pt-4">
            <div className="flex gap-3">
              {step > 0 && (
                <Button variant="outline" onClick={() => goTo(nextApplicable(step, -1))}>
                  Back
                </Button>
              )}
              <form action={deleteDraftAction.bind(null, draftId)}>
                <Button type="submit" variant="link">
                  Delete draft
                </Button>
              </form>
            </div>
            {step === REVIEW ? (
              <Button disabled={pending} onClick={submit}>
                {pending ? "Submitting…" : isCorrection ? "Resubmit FPE" : "Submit FPE"}
              </Button>
            ) : (
              <Button disabled={pending} onClick={next}>
                Next
              </Button>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
