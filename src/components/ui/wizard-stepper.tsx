export type StepState = "done" | "current" | "upcoming" | "error" | "not-applicable";

export type WizardStep = { title: string; state: StepState };

const DOT: Record<StepState, string> = {
  done: "bg-success text-white",
  current: "bg-primary text-white",
  upcoming: "bg-surface text-muted border border-line",
  error: "bg-danger text-white",
  "not-applicable": "bg-surface text-muted/60 border border-dashed border-line",
};

const CLICKABLE: StepState[] = ["done", "error"];

export function WizardStepper({
  steps,
  onSelect,
}: {
  steps: WizardStep[];
  onSelect?: (index: number) => void;
}) {
  return (
    <ol className="flex flex-col gap-1">
      {steps.map(({ title, state }, index) => {
        const content = (
          <>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${DOT[state]}`}
            >
              {state === "done" ? "✓" : state === "error" ? "!" : index + 1}
            </span>
            <span className={state === "current" ? "font-semibold text-navy" : "text-ink"}>
              {title}
              {state === "not-applicable" && (
                <span className="text-muted"> (not applicable)</span>
              )}
            </span>
          </>
        );
        return (
          <li key={title} aria-current={state === "current" ? "step" : undefined}>
            {CLICKABLE.includes(state) && onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(index)}
                className="flex w-full items-center gap-2 rounded-md p-1.5 text-left text-sm hover:bg-surface"
              >
                {content}
              </button>
            ) : (
              <div className="flex items-center gap-2 p-1.5 text-sm">{content}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
