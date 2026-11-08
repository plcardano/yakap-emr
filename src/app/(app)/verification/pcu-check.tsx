"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { ConsentField, DateField, TextField } from "@/components/ui/fields";
import { StatusChip } from "@/components/ui/status-chip";
import type { ActionFailure } from "@/lib/action-result";
import {
  checkLivenessReturn,
  draftExpiry,
  isLivenessReturn,
  LIVENESS_DRAFT_KEY,
  newLivenessState,
  type LivenessDraft,
} from "@/lib/liveness-return";
import type { PcuResult } from "@/server/verification/service";
import { startPcuAction, verifyPcuAction } from "./actions";

type LivenessClient = {
  redirect?: (options: {
    authorizationId: string;
    launchToken: string;
    launchUrl: string;
    returnUrl: string;
    returnState: string;
  }) => Promise<void>;
};

declare global {
  interface Window {
    eKYC?: () => LivenessClient;
  }
}

function loadSdk(url: string) {
  return new Promise<void>((resolve, reject) => {
    if (window.eKYC) return resolve();
    const script = document.createElement("script");
    script.src = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("sdk"));
    document.head.appendChild(script);
  });
}

const NOT_COMPLETED: ActionFailure = {
  ok: false,
  title: "The check was not completed",
  body: "The face capture was cancelled, failed or expired. Start a new check.",
};

const SDK_FAILED: ActionFailure = {
  ok: false,
  title: "The face capture could not start",
  body: "Start a new check. If this continues, contact PhilHealth support.",
};

const EMPTY = {
  pin: "",
  first_name: "",
  middle_name: "",
  last_name: "",
  suffix: "",
  birth_date: "",
};

function readDraft(): LivenessDraft | null {
  const raw = sessionStorage.getItem(LIVENESS_DRAFT_KEY);
  return raw ? (JSON.parse(raw) as LivenessDraft) : null;
}

export function PcuCheck() {
  const [values, setValues] = useState(EMPTY);
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [result, setResult] = useState<PcuResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [pending, startTransition] = useTransition();
  const returnHandled = useRef(false);

  useEffect(() => {
    if (returnHandled.current || !isLivenessReturn(location.hash)) return;
    returnHandled.current = true;

    const hash = location.hash;
    const currentUrl = location.origin + location.pathname;
    const draft = readDraft();
    history.replaceState(null, "", location.pathname);
    sessionStorage.removeItem(LIVENESS_DRAFT_KEY);

    const authorizationId = checkLivenessReturn(hash, draft, currentUrl, Date.now());
    void (async () => {
      if (!authorizationId) return setFailure(NOT_COMPLETED);
      setVerifying(true);
      const outcome = await verifyPcuAction(authorizationId);
      setVerifying(false);
      if (outcome.ok) setResult(outcome.data);
      else setFailure(outcome);
    })();
  }, []);

  const field = (name: keyof typeof EMPTY) => ({
    name,
    value: values[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
      setValues((current) => ({ ...current, [name]: event.target.value })),
    error: failure?.fieldErrors?.[name],
  });

  function reset() {
    setValues(EMPTY);
    setConsent(false);
    setFailure(null);
    setResult(null);
  }

  function start(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    startTransition(async () => {
      const outcome = await startPcuAction({ ...values, consent });
      if (!outcome.ok) return setFailure(outcome);

      const started = outcome.data;
      const returnUrl = location.origin + location.pathname;
      const state = newLivenessState();
      try {
        await loadSdk(started.sdk_url);
        const client = window.eKYC?.();
        if (typeof client?.redirect !== "function") throw new Error("sdk");

        // The launch token goes only to the SDK and is never stored.
        const draft: LivenessDraft = {
          authorizationId: started.authorization_id,
          state,
          returnUrl,
          expiresAt: draftExpiry(started.expires_at, Date.now()),
        };
        sessionStorage.setItem(LIVENESS_DRAFT_KEY, JSON.stringify(draft));

        await client.redirect({
          authorizationId: started.authorization_id,
          launchToken: started.launch_token,
          launchUrl: started.launch_url,
          returnUrl,
          returnState: state,
        });
      } catch {
        sessionStorage.removeItem(LIVENESS_DRAFT_KEY);
        setFailure(SDK_FAILED);
      }
    });
  }

  if (verifying) {
    return <p className="text-sm text-muted">Verifying with PhilHealth…</p>;
  }

  if (result) return <PcuResultCard result={result} onNew={reset} />;

  const showSummary = failure && !failure.fieldErrors;

  return (
    <form onSubmit={start} noValidate className="flex flex-col gap-4">
      {showSummary && (
        <ErrorSummary title={failure.title} body={failure.body} requestId={failure.requestId} />
      )}
      <p className="text-sm text-muted">
        Enter the details exactly as they appear on the patient&apos;s record. The patient then
        completes a live face capture on this device.
      </p>
      <div className="grid gap-3 md:grid-cols-3">
        <TextField label="Last name" required {...field("last_name")} />
        <TextField label="First name" required {...field("first_name")} />
        <TextField label="Middle name" optional {...field("middle_name")} />
        <TextField label="Suffix" optional {...field("suffix")} />
        <DateField label="Date of birth" required {...field("birth_date")} />
        <TextField
          label="PIN"
          optional
          placeholder="12 digits, no dashes"
          inputMode="numeric"
          maxLength={12}
          {...field("pin")}
        />
      </div>
      <ConsentField
        checked={consent}
        onChange={setConsent}
        error={failure?.fieldErrors?.consent}
      />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Starting…" : "Start PhilHealth Check"}
        </Button>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 border-b border-line py-2 text-sm last:border-b-0">
      <dt className="text-muted">{label}</dt>
      <dd className="break-all text-right font-semibold text-ink">{value}</dd>
    </div>
  );
}

function PcuResultCard({ result, onNew }: { result: PcuResult; onNew: () => void }) {
  const { outcome, konsulta } = result;

  return (
    <div className="flex max-w-xl flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold text-navy">{outcome.title}</h2>
        <StatusChip
          tone={outcome.verified ? "success" : "danger"}
          text={outcome.verified ? "Verified" : "Not verified"}
        />
      </div>
      <p className="text-sm text-ink">{outcome.body}</p>

      {result.pin_matched === "N" && (
        <p role="alert" className="rounded-md bg-warning-soft px-3 py-2 text-sm text-warning">
          The PIN you entered differs from the PIN PhilHealth found. Confirm the patient&apos;s
          identity before continuing.
        </p>
      )}

      <dl>
        <Row label="Transaction no." value={result.trans_no} />
        <Row label="PIN" value={result.member?.pin} />
        <Row label="Result code" value={result.result_code} />
        <Row label="YAKAP Clinic" value={konsulta?.hci_name} />
        <Row label="Date assigned" value={konsulta?.date_assigned} />
      </dl>

      <div>
        <Button variant="outline" onClick={onNew}>
          Start a new check
        </Button>
      </div>
    </div>
  );
}
