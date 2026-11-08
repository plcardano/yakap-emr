import { requireUser } from "@/server/auth/session";
import { EmpanelmentSearch } from "./empanelment-search";

export default async function EmpanelmentPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">YAKAP Empanelment</h1>
        <p className="mt-1 text-muted">Record the Mutual Care Agreement with your clinic.</p>
      </header>
      <EmpanelmentSearch />
    </div>
  );
}
