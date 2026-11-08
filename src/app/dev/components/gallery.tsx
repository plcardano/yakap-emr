"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import {
  AutoField,
  DateField,
  NumberField,
  SelectField,
  TextAreaField,
  TextField,
  YesNo,
  type YesNoValue,
} from "@/components/ui/fields";
import { Modal } from "@/components/ui/modal";
import { StatusChip } from "@/components/ui/status-chip";
import { ActionBox, StatusRow } from "@/components/ui/status-row";
import { WizardStepper } from "@/components/ui/wizard-stepper";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-3 text-lg font-semibold text-navy">{title}</h2>
      {children}
    </section>
  );
}

export function Gallery() {
  const [yesNo, setYesNo] = useState<YesNoValue>(null);
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-col gap-5 px-4 py-8">
      <h1 className="text-3xl font-bold text-navy">Components</h1>

      <Section title="Buttons">
        <div className="flex flex-wrap items-start gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="outline">Outline</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="link">Link</Button>
          <Button disabledReason="Upload the FPE first.">Disabled</Button>
        </div>
      </Section>

      <Section title="Status chips">
        <div className="flex flex-wrap gap-2">
          <StatusChip tone="success" text="Accepted" />
          <StatusChip tone="danger" text="Rejected" />
          <StatusChip tone="warning" text="Queued" />
          <StatusChip tone="neutral" text="Not assigned" />
          <StatusChip tone="info" text="Processing" />
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField label="Last name" required />
          <TextField label="Middle name" optional />
          <TextField label="With error" error="This field is required." />
          <DateField label="Date of birth" required />
          <NumberField label="Weight" unit="kg" />
          <SelectField
            label="Sex"
            options={[
              { value: "M", label: "Male" },
              { value: "F", label: "Female" },
            ]}
          />
          <TextAreaField label="Notes" optional />
          <AutoField label="PIN" value="123456789012" source="From PhilHealth Check" />
          <YesNo question="Is on dialysis?" value={yesNo} onChange={setYesNo} />
        </div>
      </Section>

      <Section title="Error summary">
        <ErrorSummary
          title="The submission was rejected"
          body="Correct these fields and submit again."
          requestId="550e8400-e29b-41d4-a716-446655440000"
          errors={[{ field: "enlistment.patient_pin", issue: "validation_error", href: "#" }]}
        />
      </Section>

      <Section title="Wizard stepper">
        <WizardStepper
          steps={[
            { title: "Patient details", state: "done" },
            { title: "Medical history", state: "error" },
            { title: "Physical exam", state: "current" },
            { title: "Women's health", state: "not-applicable" },
            { title: "Review and submit", state: "upcoming" },
          ]}
          onSelect={() => undefined}
        />
      </Section>

      <Section title="Status row and action box">
        <StatusRow
          title="PhilHealth Check"
          state="done"
          detail={{ label: "Transaction no.", value: "PCU-LOG-TRANS-NO" }}
        />
        <StatusRow title="First Patient Encounter" state="wait" />
        <StatusRow title="Empanelment" state="todo" />
        <div className="mt-3">
          <ActionBox title="Next step" body="Upload the FPE to continue.">
            <Button>Open FPE</Button>
          </ActionBox>
        </div>
      </Section>

      <Section title="Modal">
        <Button variant="outline" onClick={() => setModalOpen(true)}>
          Open modal
        </Button>
        <Modal
          open={modalOpen}
          title="Example"
          onClose={() => setModalOpen(false)}
          footer={<Button onClick={() => setModalOpen(false)}>Done</Button>}
        >
          Modal content.
        </Modal>
      </Section>
    </main>
  );
}
