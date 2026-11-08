import { requireUser } from "@/server/auth/session";
import { manilaDate } from "@/server/pcapi/record-number-format";
import { SlipForm } from "./slip-form";

export default async function AvailmentSlipPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">YAKAP Availment Slip</h1>
        <p className="mt-1 text-muted">View, download or print a beneficiary&apos;s slip.</p>
      </header>
      <SlipForm currentYear={manilaDate().slice(0, 4)} />
    </div>
  );
}
