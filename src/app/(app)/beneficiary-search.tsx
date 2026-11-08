"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DateField, TextField } from "@/components/ui/fields";

type Mode = "pin" | "name";

const MODES: { id: Mode; label: string }[] = [
  { id: "pin", label: "By PIN" },
  { id: "name", label: "By name and date of birth" },
];

export function BeneficiarySearch() {
  const [mode, setMode] = useState<Mode>("pin");

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-3 text-lg font-semibold text-navy">Find a beneficiary</h2>
      <div className="mb-4 flex flex-wrap gap-2">
        {MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => setMode(id)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold ${
              mode === id ? "bg-primary-soft text-navy" : "text-muted hover:text-navy"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <form
        className="flex flex-col gap-3 md:flex-row md:items-end"
        onSubmit={(event) => event.preventDefault()}
      >
        {mode === "pin" ? (
          <div className="flex-1">
            <TextField
              label="PhilHealth Identification No. (PIN)"
              name="patient_pin"
              placeholder="12 digits, no dashes"
              inputMode="numeric"
              maxLength={12}
              pattern="\d{12}"
            />
          </div>
        ) : (
          <div className="grid flex-1 gap-3 md:grid-cols-3">
            <TextField label="First name" name="first_name" maxLength={30} />
            <TextField label="Last name" name="last_name" maxLength={30} />
            <DateField label="Date of birth" name="patient_dob" />
          </div>
        )}
        <Button type="submit" disabledReason="Search starts working in Phase 3.">
          Check status
        </Button>
      </form>
    </section>
  );
}
