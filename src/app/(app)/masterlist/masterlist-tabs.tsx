"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { ConsentField, DateField, TextField } from "@/components/ui/fields";
import { StatusChip, type Tone } from "@/components/ui/status-chip";
import type { ActionFailure } from "@/lib/action-result";
import { toCsv } from "@/lib/csv";
import type { MasterlistAssignment, MasterlistData } from "@/server/pcapi/services";
import { downloadBatchAction, lookupAssignmentAction } from "./actions";

const ASSIGNMENT: Record<MasterlistAssignment["assignment_status"], { tone: Tone; text: string }> = {
  "1": { tone: "success", text: "Active" },
  "2": { tone: "warning", text: "Cancelled" },
  "3": { tone: "warning", text: "Transferred" },
};

const COLUMNS: { header: string; value: (row: MasterlistAssignment) => string }[] = [
  { header: "PIN", value: (row) => row.patient_pin },
  { header: "Last name", value: (row) => row.patient_lname },
  { header: "First name", value: (row) => row.patient_fname },
  { header: "Middle name", value: (row) => row.patient_mname },
  { header: "Extension", value: (row) => row.patient_extname },
  { header: "Date of birth", value: (row) => row.patient_dob },
  { header: "Sex", value: (row) => row.patient_sex },
  { header: "Patient type", value: (row) => (row.patient_type === "MM" ? "Member" : "Dependent") },
  { header: "Member PIN", value: (row) => row.member_pin },
  { header: "Mobile no.", value: (row) => row.patient_mobile_no },
  { header: "Category", value: (row) => row.member_category_desc },
  { header: "Assignment date", value: (row) => row.assignment_date },
  { header: "Status", value: (row) => ASSIGNMENT[row.assignment_status].text },
  { header: "Effectivity year", value: (row) => row.eff_year },
];

function downloadCsv(data: MasterlistData) {
  const blob = new Blob([toCsv(data.assignments, COLUMNS)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `masterlist_${data.transmittal_no}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

function Results({ data }: { data: MasterlistData }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-navy">
            {data.total_records} {data.total_records === 1 ? "record" : "records"}
          </h2>
          <p className="break-all text-xs text-muted">Transmittal no. {data.transmittal_no}</p>
        </div>
        {data.total_records > 0 && (
          <Button variant="outline" onClick={() => downloadCsv(data)}>
            Download CSV
          </Button>
        )}
      </div>
      {data.total_records === 0 ? (
        <p className="text-sm text-muted">No beneficiaries were assigned in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                <th className="py-2 pr-3 font-semibold">PIN</th>
                <th className="py-2 pr-3 font-semibold">Name</th>
                <th className="py-2 pr-3 font-semibold">Date of birth</th>
                <th className="py-2 pr-3 font-semibold">Type</th>
                <th className="py-2 pr-3 font-semibold">Assigned</th>
                <th className="py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.assignments.map((row) => (
                <tr key={`${row.patient_pin}-${row.eff_year}`} className="border-b border-line last:border-b-0">
                  <td className="py-2 pr-3">{row.patient_pin}</td>
                  <td className="py-2 pr-3 font-semibold text-navy">
                    {row.patient_lname}, {row.patient_fname} {row.patient_mname} {row.patient_extname}
                  </td>
                  <td className="py-2 pr-3">{row.patient_dob}</td>
                  <td className="py-2 pr-3">{row.patient_type === "MM" ? "Member" : "Dependent"}</td>
                  <td className="py-2 pr-3">{row.assignment_date}</td>
                  <td className="py-2">
                    <StatusChip {...ASSIGNMENT[row.assignment_status]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type Mode = "individual" | "batch";

export function MasterlistTabs({
  defaultStart,
  defaultEnd,
}: {
  defaultStart: string;
  defaultEnd: string;
}) {
  const [mode, setMode] = useState<Mode>("individual");
  const [pin, setPin] = useState("");
  const [year, setYear] = useState("");
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<MasterlistData | null>(null);
  const [pending, startTransition] = useTransition();

  function choose(next: Mode) {
    setMode(next);
    setFailure(null);
    setResult(null);
    setConsent(false);
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setResult(null);
    startTransition(async () => {
      const outcome =
        mode === "individual"
          ? await lookupAssignmentAction({ patient_pin: pin, eff_year: year, consent })
          : await downloadBatchAction({ start_date: start, end_date: end, consent });
      if (outcome.ok) setResult(outcome.data);
      else setFailure(outcome);
    });
  }

  const errors = failure?.fieldErrors;
  const tab = (id: Mode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === id}
      onClick={() => choose(id)}
      className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
        mode === id ? "bg-primary-soft text-navy" : "text-muted hover:text-navy"
      }`}
    >
      {label}
    </button>
  );

  return (
    <>
      <form
        onSubmit={submit}
        noValidate
        className="flex max-w-xl flex-col gap-4 rounded-xl border border-line bg-card p-5"
      >
        <div className="flex flex-wrap gap-2">
          {tab("individual", "By PIN")}
          {tab("batch", "By assignment date")}
        </div>
        {failure && !errors && (
          <ErrorSummary title={failure.title} body={failure.body} requestId={failure.requestId} />
        )}
        {mode === "individual" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <TextField
              label="PIN"
              required
              placeholder="12 digits, no dashes"
              inputMode="numeric"
              maxLength={12}
              value={pin}
              error={errors?.patient_pin}
              onChange={(event) => setPin(event.target.value)}
            />
            <TextField
              label="Effectivity year"
              optional
              placeholder="YYYY"
              inputMode="numeric"
              maxLength={4}
              value={year}
              error={errors?.eff_year}
              onChange={(event) => setYear(event.target.value)}
            />
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            <DateField
              label="Start date"
              required
              value={start}
              error={errors?.start_date}
              onChange={(event) => setStart(event.target.value)}
            />
            <DateField
              label="End date"
              required
              value={end}
              error={errors?.end_date}
              onChange={(event) => setEnd(event.target.value)}
            />
            <p className="text-xs text-muted md:col-span-2">Up to 7 days, counting both dates.</p>
          </div>
        )}
        <ConsentField
          checked={consent}
          onChange={setConsent}
          error={errors?.consent}
          text={
            mode === "batch"
              ? "The beneficiaries in this list gave explicit consent to process their personal and health information under the Data Privacy Act of 2012."
              : undefined
          }
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Loading…" : mode === "individual" ? "Look up" : "Get list"}
          </Button>
        </div>
      </form>
      {result && <Results data={result} />}
    </>
  );
}
