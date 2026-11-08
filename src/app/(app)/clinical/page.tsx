import { requireUser } from "@/server/auth/session";
import { listUploads } from "@/server/uploads/service";
import { ClinicalList } from "./clinical-list";
import { NewConsultationForm } from "./new-consultation-form";

export const metadata = { title: "Clinical uploads" };

export default async function ClinicalPage() {
  const user = await requireUser();
  const items = await listUploads(user, [
    "consultation",
    "diagnostic_request",
    "diagnostic_results",
    "medicine",
    "referral",
  ]);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">Clinical uploads</h1>
        <p className="mt-1 text-muted">
          Record a consultation, then its diagnostics, medicines and referrals.
        </p>
      </header>
      <NewConsultationForm />
      <ClinicalList items={items} />
    </div>
  );
}
