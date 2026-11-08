"use client";

import { useState } from "react";
import { OtpForm } from "./otp-form";
import { PcuCheck } from "./pcu-check";
import { ValidIdForm } from "./valid-id-form";

type Mode = "pcu" | "otp" | "valid_id";

const MODES: { id: Mode; label: string }[] = [
  { id: "pcu", label: "PhilHealth Check" },
  { id: "otp", label: "Verification code" },
  { id: "valid_id", label: "Valid ID" },
];

export function VerificationTabs({
  today,
  validIdTypes,
}: {
  today: string;
  validIdTypes: { value: string; label: string }[];
}) {
  const [mode, setMode] = useState<Mode>("pcu");

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={mode === id}
            onClick={() => setMode(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              mode === id ? "bg-primary-soft text-navy" : "text-muted hover:text-navy"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {mode === "pcu" && <PcuCheck />}
      {mode === "otp" && <OtpForm today={today} />}
      {mode === "valid_id" && <ValidIdForm types={validIdTypes} />}
    </section>
  );
}
