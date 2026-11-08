import { requireUser } from "@/server/auth/session";
import { todayUs } from "@/server/pcapi/today";
import { SelectionForm } from "./selection-form";

export default async function SelectionPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">YAKAP Selection</h1>
        <p className="mt-1 text-muted">Assign a verified beneficiary to your clinic.</p>
      </header>
      <SelectionForm today={todayUs()} />
    </div>
  );
}
