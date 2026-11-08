"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { ConsentField, TextField } from "@/components/ui/fields";
import type { ActionFailure } from "@/lib/action-result";
import { fetchSlipAction } from "./actions";

type Slip = { url: string; fileName: string };

function toBlobUrl(base64: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
}

export function SlipForm({ currentYear }: { currentYear: string }) {
  const [pin, setPin] = useState("");
  const [year, setYear] = useState(currentYear);
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [slip, setSlip] = useState<Slip | null>(null);
  const [pending, startTransition] = useTransition();
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    return () => {
      if (slip) URL.revokeObjectURL(slip.url);
    };
  }, [slip]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setSlip(null);
    startTransition(async () => {
      const outcome = await fetchSlipAction({ patient_pin: pin, eff_year: year, consent });
      if (outcome.ok) {
        setSlip({ url: toBlobUrl(outcome.data.base64), fileName: outcome.data.fileName });
      } else {
        setFailure(outcome);
      }
    });
  }

  const errors = failure?.fieldErrors;

  return (
    <>
      <form
        onSubmit={submit}
        noValidate
        className="flex max-w-xl flex-col gap-4 rounded-xl border border-line bg-card p-5"
      >
        {failure && !errors && (
          <ErrorSummary title={failure.title} body={failure.body} requestId={failure.requestId} />
        )}
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
            required
            placeholder="YYYY"
            inputMode="numeric"
            maxLength={4}
            value={year}
            error={errors?.eff_year}
            onChange={(event) => setYear(event.target.value)}
          />
        </div>
        <ConsentField checked={consent} onChange={setConsent} error={errors?.consent} />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Loading…" : "Get slip"}
          </Button>
        </div>
      </form>

      {slip && (
        <section className="flex flex-col gap-3 rounded-xl border border-line bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="break-all text-lg font-semibold text-navy">{slip.fileName}</h2>
            <div className="flex gap-3">
              <a
                href={slip.url}
                download={slip.fileName}
                className="whitespace-nowrap rounded-md border border-line px-4 py-2 text-sm font-semibold text-navy hover:bg-surface"
              >
                Download
              </a>
              <Button onClick={() => frame.current?.contentWindow?.print()}>Print</Button>
            </div>
          </div>
          <iframe
            ref={frame}
            src={slip.url}
            title="YAKAP Availment Slip"
            className="h-[70vh] w-full rounded-md border border-line"
          />
        </section>
      )}
    </>
  );
}
