import { Button, ButtonLink } from "@/components/ui/button";
import { requireUser } from "@/server/auth/session";
import { BeneficiaryLookup } from "./validator/beneficiary-lookup";

export default async function HomePage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">What do you need to do?</h1>
        <p className="mt-1 text-muted">Find a beneficiary, then pick the task.</p>
      </header>

      <BeneficiaryLookup />

      <section className="grid gap-4 md:grid-cols-3" aria-label="Tasks">
        <article className="flex flex-col items-start gap-3 rounded-xl border border-line bg-card p-5">
          <h2 className="text-lg font-semibold text-navy">Patient verification</h2>
          <p className="flex-1 text-sm text-muted">
            Verify a patient with PhilHealth Check, a verification code or a valid ID.
          </p>
          <ButtonLink variant="outline" href="/verification">
            Verify patient
          </ButtonLink>
        </article>
        <article className="flex flex-col items-start gap-3 rounded-xl border border-line bg-card p-5">
          <h2 className="text-lg font-semibold text-navy">YAKAP Selection</h2>
          <p className="flex-1 text-sm text-muted">
            Assign a beneficiary to your clinic after verification.
          </p>
          <ButtonLink variant="outline" href="/selection">
            Start Selection
          </ButtonLink>
        </article>
        <article className="flex flex-col items-start gap-3 rounded-xl border border-line bg-card p-5">
          <h2 className="text-lg font-semibold text-navy">Empanelment</h2>
          <p className="flex-1 text-sm text-muted">
            Record the Mutual Care Agreement after an accepted FPE.
          </p>
          <Button variant="outline" disabledReason="Not available yet.">
            Open Empanelment
          </Button>
        </article>
      </section>
    </div>
  );
}
