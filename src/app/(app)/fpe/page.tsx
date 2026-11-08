import { requireUser } from "@/server/auth/session";
import { listFpe } from "@/server/fpe/service";
import { FpeList } from "./fpe-list";
import { NewFpeForm } from "./new-fpe-form";

export default async function FpePage() {
  const user = await requireUser();
  const items = await listFpe(user);

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">First Patient Encounter</h1>
        <p className="mt-1 text-muted">
          Start an FPE for a beneficiary assigned to your clinic, or continue a draft.
        </p>
      </header>
      <NewFpeForm />
      <FpeList items={items} />
    </div>
  );
}
