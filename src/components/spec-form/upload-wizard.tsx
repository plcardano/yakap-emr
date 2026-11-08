"use client";

import { useRouter } from "next/navigation";
import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { SpecGroup, type SpecFormConfig } from "@/components/spec-form/spec-form";
import { Button, ButtonLink } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { AutoField, ConsentField } from "@/components/ui/fields";
import { WizardStepper, type StepState } from "@/components/ui/wizard-stepper";
import type { ActionFailure } from "@/lib/action-result";
import { createChecker, stepIndexFor } from "@/lib/upload-forms/checker";
import { FORM_DEFINITIONS } from "@/lib/upload-forms/registry";
import type { Values } from "@/lib/upload-forms/types";
import { FALLBACK_REASON, REASON_COPY } from "@/lib/pcapi-messages";
import type { FieldLabel, FieldRule, LibraryCode, UploadForm } from "@/lib/pcapi-spec/types";
import type { VerificationMode } from "@/server/verification/evidence";
import { MODE_LABELS } from "@/app/(app)/selection/mode-labels";
import {
  deleteDraftAction,
  loadCodesAction,
  saveDraftAction,
  submitDraftAction,
} from "@/app/(app)/uploads/actions";

function setIn(target: Values, path: (string | number)[], value: unknown): Values {
  const [head, ...rest] = path;
  const copy: Values = Array.isArray(target) ? [...target] : { ...target };
  copy[head] = rest.length === 0 ? value : setIn(copy[head] ?? {}, rest, value);
  return copy;
}

export function UploadWizard({
  form,
  exitHref,
  draftId,
  initialValues,
  initialStep,
  isCorrection,
  evidence,
  rules,
  labels,
  libraries,
}: {
  form: UploadForm;
  exitHref: string;
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
  const definition = FORM_DEFINITIONS[form];
  const { tree, check } = useMemo(
    () => createChecker(definition, rules, libraries),
    [definition, rules, libraries],
  );
  const steps = definition.steps;
  const review = steps.length - 1;
  const isApplicable = (index: number) =>
    definition.isStepApplicable?.(steps[index], values) ?? true;
  const [values, setValues] = useState(initialValues);
  const [step, setStep] = useState(initialStep);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failedSteps, setFailedSteps] = useState<Set<number>>(new Set());
  const [visited, setVisited] = useState(initialStep);
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [pending, startTransition] = useTransition();
  const top = useRef<HTMLDivElement>(null);

  const onChange = useCallback(
    (path: (string | number)[], value: unknown) => {
      setValues((current) => {
        const next = setIn(current, path, value);
        return definition.derive?.(next) ?? next;
      });
    },
    [definition],
  );

  const config: SpecFormConfig = {
    labels,
    libraries,
    groupTitles: definition.groupTitles,
    hidden: definition.hidden,
    readOnly: definition.readOnly,
    alsoRequired: definition.alsoRequired?.(values) ?? new Set<string>(),
    showNested: definition.showNested,
    fixedRows: definition.fixedRows,
    errors,
    loadCodes: loadCodesAction,
    onChange,
  };

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
    while (steps[index] && !isApplicable(index)) index += direction;
    return index;
  }

  function issuesForStep(index: number) {
    const { groups } = steps[index];
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
        .map((field) => stepIndexFor(definition, field))
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
      const outcome = await submitDraftAction({ draftId, values, consent });
      if (outcome.ok) {
        router.push(exitHref);
        return;
      }
      showFailure(outcome);
    });
  }

  const stepStates = steps.map((candidate, index) => {
    let state: StepState = "upcoming";
    if (!isApplicable(index)) state = "not-applicable";
    else if (index === step) state = "current";
    else if (failedSteps.has(index)) state = "error";
    else if (index < visited) state = "done";
    return { title: candidate.title, state };
  });

  const current = steps[step];
  const groups = definition.visibleGroups?.(current.groups, values) ?? current.groups;
  const patient = definition.describePatient(values);
  const showSummary = failure && (!failure.fieldErrors || failure.requestId);
  const verification = definition.verification;
  const showVerification = verification?.stepId === current.id;
  const verificationField = `${verification?.group}.patient_verification_mode`;
  const derived = definition.derivedFields?.(current.id, values) ?? [];
  const showToggles = current.id === "specific" && definition.toggles;

  return (
    <div ref={top} className="flex flex-col gap-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-navy">{definition.title}</h1>
          <p className="mt-1 text-muted">
            {patient}
            {isCorrection && " · Correcting a rejected submission"}
          </p>
        </div>
        <ButtonLink variant="outline" href={exitHref}>
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

          {showVerification && (
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
                        checked={values[verification!.group]?.patient_verification_mode === mode}
                        onChange={() => onChange([verification!.group, "patient_verification_mode"], mode)}
                      />
                      {MODE_LABELS[mode]}
                    </label>
                  ))}
                </div>
              )}
              {errors[verificationField] && (
                <p className="text-xs text-danger">Choose how the patient was verified today.</p>
              )}
            </fieldset>
          )}

          {showToggles && (
            <fieldset>
              <legend className="text-sm font-semibold text-ink">
                Specific forms accomplished during this consultation
              </legend>
              <div className="mt-1 flex flex-wrap gap-4">
                {definition.toggles
                  ?.filter((toggle) => toggle.isAvailable?.(values) ?? true)
                  .map((toggle) => (
                    <label key={toggle.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(values.__forms?.[toggle.id])}
                        onChange={(event) =>
                          onChange(["__forms", toggle.id], event.target.checked)
                        }
                      />
                      {toggle.label}
                    </label>
                  ))}
              </div>
            </fieldset>
          )}

          {groups.map((group) => (
            <SpecGroup key={group} tree={tree} group={group} values={values} config={config} />
          ))}

          {derived.map((field) => (
            <AutoField key={field.label} {...field} />
          ))}

          {current.id === "review" && (
            <div className="flex flex-col gap-4">
              <ul className="flex flex-col gap-1 text-sm">
                {steps
                  .slice(0, review)
                  .filter((_, index) => isApplicable(index))
                  .map((candidate) => {
                    const count = candidate.groups.reduce(
                      (total, group) =>
                        total +
                        check(values).issues.filter(
                          (issue) => issue.field.split(/[.[]/)[0] === group,
                        ).length,
                      0,
                    );
                    return (
                      <li key={candidate.id} className="flex justify-between gap-3">
                        <span>{candidate.title}</span>
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
              <form action={deleteDraftAction.bind(null, draftId, exitHref)}>
                <Button type="submit" variant="link">
                  Delete draft
                </Button>
              </form>
            </div>
            {step === review ? (
              <Button disabled={pending} onClick={submit}>
                {pending ? "Submitting…" : isCorrection ? "Resubmit" : "Submit"}
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
