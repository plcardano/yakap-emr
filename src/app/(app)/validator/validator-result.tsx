import { ButtonLink } from "@/components/ui/button";
import { StatusChip, type Tone } from "@/components/ui/status-chip";
import type { ValidatorData } from "@/server/pcapi/services";

type Stage = {
  title: string;
  tone: Tone;
  state: string;
  details: { label: string; value?: string }[];
};

const PCU_STATE: Record<ValidatorData["pcu"]["status"], { tone: Tone; state: string }> = {
  VERIFIED: { tone: "success", state: "Verified" },
  FAILED: { tone: "danger", state: "Failed" },
  UNVERIFIED: { tone: "neutral", state: "Not yet" },
};

const SELECTION_STATE: Record<
  ValidatorData["selection"]["status"],
  { tone: Tone; state: string }
> = {
  ASSIGNED: { tone: "success", state: "Assigned" },
  TRANSFERRED: { tone: "warning", state: "Transferred" },
  CANCELLED: { tone: "warning", state: "Cancelled" },
  NOT_ASSIGNED: { tone: "neutral", state: "Not yet" },
};

function yesNoStage(
  title: string,
  stage: ValidatorData["fpe"],
  numberLabel: string,
): Stage {
  return {
    title,
    tone: stage.status === "Y" ? "success" : "neutral",
    state: stage.status === "Y" ? "Done" : "Not yet",
    details: [
      { label: "Date", value: stage.date },
      { label: numberLabel, value: stage.transaction_no },
    ],
  };
}

function stagesOf(data: ValidatorData): Stage[] {
  return [
    {
      title: "PhilHealth Check",
      ...PCU_STATE[data.pcu.status],
      details: [
        { label: "Latest", value: data.pcu.latest_date },
        { label: "Transaction no.", value: data.pcu.transaction_no },
      ],
    },
    {
      title: "Selection",
      ...SELECTION_STATE[data.selection.status],
      details: [
        { label: "Date", value: data.selection.date },
        { label: "Transaction no.", value: data.selection.transaction_no },
      ],
    },
    yesNoStage("First Patient Encounter", data.fpe, "Transaction no."),
    yesNoStage("Empanelment", data.empanelment, "Reference no."),
    yesNoStage("Latest consultation", data.consultation, "Transaction no."),
  ];
}

function displayName(data: ValidatorData) {
  if (!data.patient_lname) return null;
  const given = [data.patient_fname, data.patient_mname, data.patient_extname]
    .filter(Boolean)
    .join(" ");
  return `${data.patient_lname}, ${given}`;
}

export function ValidatorResult({ data }: { data: ValidatorData }) {
  // The guide says to detect this from the fields, never from the message text.
  const name = displayName(data);
  const facts = [
    `PIN ${data.patient_pin}`,
    data.patient_dob && `Date of birth ${data.patient_dob}`,
    `Effectivity year ${data.eff_year}`,
  ].filter(Boolean);

  return (
    <section className="rounded-xl border border-line bg-card p-5" aria-label="Result">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-navy">{name ?? "Beneficiary"}</h2>
          <p className="text-sm text-muted">{facts.join(" · ")}</p>
        </div>
        <StatusChip
          tone={name ? "success" : "neutral"}
          text={name ? "Assigned to your clinic" : "Not assigned to your clinic"}
        />
      </div>

      {!name && (
        <p className="mt-2 text-sm text-muted">
          Name and date of birth are shown only for beneficiaries assigned to your clinic.
        </p>
      )}

      <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {stagesOf(data).map((stage, index) => (
          <li key={stage.title} className="rounded-lg border border-line p-3">
            <p className="text-xs text-muted">Step {index + 1}</p>
            <h3 className="font-semibold text-navy">{stage.title}</h3>
            <div className="my-1">
              <StatusChip tone={stage.tone} text={stage.state} />
            </div>
            {stage.details
              .filter((detail) => detail.value)
              .map((detail) => (
                <p key={detail.label} className="break-all text-xs text-muted">
                  {detail.label}: {detail.value}
                </p>
              ))}
          </li>
        ))}
      </ol>

      {data.pcu.status !== "VERIFIED" && (
        <div className="mt-4">
          <ButtonLink href="/verification">Verify patient</ButtonLink>
        </div>
      )}
    </section>
  );
}
