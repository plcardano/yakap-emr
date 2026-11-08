"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/fields";
import { login, type LoginState } from "./actions";

const initial: LoginState = {};

export function LoginForm() {
  const [state, action, pending] = useActionState(login, initial);

  return (
    <form action={action} className="flex flex-col gap-4">
      {state.error && (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <TextField
        label="Accreditation No."
        name="accreNo"
        placeholder="H9XXXXXXX"
        maxLength={9}
        autoComplete="organization"
        defaultValue={state.values?.accreNo}
        required
        error={state.fieldErrors?.accreNo}
      />
      <TextField
        label="User Name"
        name="username"
        autoComplete="username"
        defaultValue={state.values?.username}
        required
        error={state.fieldErrors?.username}
      />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
        error={state.fieldErrors?.password}
      />
      <div className="mt-2 flex justify-end gap-3">
        <Button type="reset" variant="outline">
          Clear
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Logging in…" : "Log in"}
        </Button>
      </div>
    </form>
  );
}
