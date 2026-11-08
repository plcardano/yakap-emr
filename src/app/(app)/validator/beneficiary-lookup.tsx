"use client";

import { lookupAction } from "./actions";
import { LookupForm } from "./lookup-form";
import { ValidatorResult } from "./validator-result";

export function BeneficiaryLookup() {
  return (
    <LookupForm search={lookupAction} renderResult={(data) => <ValidatorResult data={data} />} />
  );
}
