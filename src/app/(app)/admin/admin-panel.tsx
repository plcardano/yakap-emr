"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { SelectField, TextField } from "@/components/ui/fields";
import { Modal } from "@/components/ui/modal";
import { StatusChip } from "@/components/ui/status-chip";
import type { ActionFailure } from "@/lib/action-result";
import type { StaffRow } from "@/server/admin/service";
import {
  createStaffAction,
  resetPasswordAction,
  setActiveAction,
  setCipherKeyAction,
} from "./actions";

const EMPTY = { username: "", displayName: "", password: "", role: "staff" as const };
const ROLES = [
  { value: "staff", label: "Staff" },
  { value: "admin", label: "Administrator" },
];

function AddStaff() {
  const [values, setValues] = useState<{
    username: string;
    displayName: string;
    password: string;
    role: "staff" | "admin";
  }>(EMPTY);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setSaved(false);
    startTransition(async () => {
      const outcome = await createStaffAction(values);
      if (outcome.ok) {
        setValues(EMPTY);
        setSaved(true);
      } else {
        setFailure(outcome);
      }
    });
  }

  const errors = failure?.fieldErrors;

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3">
      <h3 className="font-semibold text-navy">Add a staff member</h3>
      {saved && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          The account was created.
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        <TextField
          label="User name"
          required
          autoComplete="off"
          value={values.username}
          error={errors?.username}
          onChange={(event) => setValues({ ...values, username: event.target.value })}
        />
        <TextField
          label="Full name"
          required
          autoComplete="off"
          value={values.displayName}
          error={errors?.displayName}
          onChange={(event) => setValues({ ...values, displayName: event.target.value })}
        />
        <TextField
          label="Temporary password"
          required
          type="password"
          autoComplete="new-password"
          value={values.password}
          error={errors?.password}
          onChange={(event) => setValues({ ...values, password: event.target.value })}
        />
        <SelectField
          label="Role"
          required
          options={ROLES}
          value={values.role}
          onChange={(event) =>
            setValues({ ...values, role: event.target.value as "staff" | "admin" })
          }
        />
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Creating…" : "Create account"}
        </Button>
      </div>
    </form>
  );
}

function CipherKey({ hasCipherKey }: { hasCipherKey: boolean }) {
  const [key, setKey] = useState("");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setSaved(false);
    startTransition(async () => {
      const outcome = await setCipherKeyAction(key);
      if (outcome.ok) {
        setKey("");
        setSaved(true);
      } else {
        setFailure(outcome);
      }
    });
  }

  return (
    <section className="flex max-w-xl flex-col gap-3 rounded-xl border border-line bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-navy">PhilHealth cipher key</h2>
        <StatusChip tone={hasCipherKey ? "success" : "warning"} text={hasCipherKey ? "Set" : "Not set"} />
      </div>
      <p className="text-sm text-muted">
        Issued by PhilHealth for this accreditation number. It is stored encrypted and is never
        shown again.
      </p>
      {saved && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          The cipher key was saved.
        </p>
      )}
      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        <TextField
          label={hasCipherKey ? "Replace the cipher key" : "Cipher key"}
          required
          type="password"
          autoComplete="off"
          value={key}
          error={failure?.fieldErrors?.cipherKey}
          onChange={(event) => setKey(event.target.value)}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save key"}
          </Button>
        </div>
      </form>
    </section>
  );
}

export function AdminPanel({
  currentUserId,
  staff,
  facility,
}: {
  currentUserId: string;
  staff: StaffRow[];
  facility: { name: string; hasCipherKey: boolean };
}) {
  const [target, setTarget] = useState<StaffRow | null>(null);
  const [password, setPassword] = useState("");
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [notice, setNotice] = useState("");
  const [pending, startTransition] = useTransition();

  function toggle(row: StaffRow) {
    setFailure(null);
    setNotice("");
    startTransition(async () => {
      const outcome = await setActiveAction(row.id, !row.active);
      if (!outcome.ok) setFailure(outcome);
    });
  }

  function closeReset() {
    setTarget(null);
    setPassword("");
    setFailure(null);
  }

  function reset() {
    if (!target) return;
    setFailure(null);
    startTransition(async () => {
      const outcome = await resetPasswordAction(target.id, password);
      if (outcome.ok) {
        setNotice(`The password for ${target.username} was reset.`);
        closeReset();
      } else {
        setFailure(outcome);
      }
    });
  }

  return (
    <>
      <section className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5">
        <h2 className="text-lg font-semibold text-navy">Staff at {facility.name}</h2>
        {notice && (
          <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
            {notice}
          </p>
        )}
        {failure && !failure.fieldErrors && !target && <ErrorSummary title={failure.title} />}
        <ul>
          {staff.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0"
            >
              <div>
                <p className="font-semibold text-navy">{row.displayName}</p>
                <p className="text-xs text-muted">
                  {row.username} · {row.role === "admin" ? "Administrator" : "Staff"}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <StatusChip
                  tone={row.active ? "success" : "neutral"}
                  text={row.active ? "Active" : "Inactive"}
                />
                <Button variant="outline" onClick={() => setTarget(row)}>
                  Reset password
                </Button>
                {row.id !== currentUserId && (
                  <Button
                    variant={row.active ? "danger" : "outline"}
                    disabled={pending}
                    onClick={() => toggle(row)}
                  >
                    {row.active ? "Deactivate" : "Activate"}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className="border-t border-line pt-4">
          <AddStaff />
        </div>
      </section>

      <CipherKey hasCipherKey={facility.hasCipherKey} />

      <Modal
        open={Boolean(target)}
        title={`Reset password for ${target?.username ?? ""}`}
        onClose={closeReset}
        footer={
          <>
            <Button variant="outline" onClick={closeReset}>
              Cancel
            </Button>
            <Button disabled={pending} onClick={reset}>
              Reset password
            </Button>
          </>
        }
      >
        <TextField
          label="New password"
          required
          type="password"
          autoComplete="new-password"
          value={password}
          error={failure?.fieldErrors?.password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </Modal>
    </>
  );
}
