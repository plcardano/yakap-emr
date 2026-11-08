import { requireUser } from "@/server/auth/session";
import { BeneficiaryLookup } from "./beneficiary-lookup";

export default async function ValidatorPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">Primary Care Validator</h1>
        <p className="mt-1 text-muted">
          Check where a beneficiary stands in the YAKAP journey before you transact.
        </p>
      </header>
      <BeneficiaryLookup />
    </div>
  );
}
