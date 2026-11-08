import type { ReactNode } from "react";
import { StatusChip, type Tone } from "./status-chip";

export type RowState = "done" | "todo" | "wait";

const STATE: Record<RowState, { tone: Tone; text: string }> = {
  done: { tone: "success", text: "Done" },
  todo: { tone: "neutral", text: "To do" },
  wait: { tone: "warning", text: "Waiting" },
};

export function StatusRow({
  title,
  state,
  detail,
  action,
}: {
  title: string;
  state: RowState;
  detail?: { label: string; value: string };
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-navy">{title}</h3>
          <StatusChip {...STATE[state]} />
        </div>
        {detail && (
          <p className="mt-0.5 text-sm text-muted">
            {detail.label}: {detail.value}
          </p>
        )}
      </div>
      {action}
    </div>
  );
}

export function ActionBox({
  title,
  body,
  children,
}: {
  title: string;
  body?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-lg bg-primary-soft p-4">
      <h3 className="font-semibold text-navy">{title}</h3>
      {body && <p className="mt-1 text-sm text-ink">{body}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
