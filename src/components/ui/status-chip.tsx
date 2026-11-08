export type Tone = "success" | "danger" | "warning" | "neutral" | "info";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  danger: "bg-danger-soft text-danger",
  warning: "bg-warning-soft text-warning",
  neutral: "bg-surface text-muted",
  info: "bg-info-soft text-info",
};

export function StatusChip({ tone, text }: { tone: Tone; text: string }) {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]}`}
    >
      {text}
    </span>
  );
}
