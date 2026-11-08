import { requireUser } from "@/server/auth/session";
import { manilaDate } from "@/server/pcapi/record-number-format";
import { todayUs } from "@/server/pcapi/today";
import { MasterlistTabs } from "./masterlist-tabs";

function sixDaysAgo() {
  const [year, month, day] = manilaDate().split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day - 6));
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(start.getUTCMonth() + 1)}/${pad(start.getUTCDate())}/${start.getUTCFullYear()}`;
}

export const metadata = { title: "Selection masterlist" };

export default async function MasterlistPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">Selection masterlist</h1>
        <p className="mt-1 text-muted">Look up or download the beneficiaries assigned to your clinic.</p>
      </header>
      <MasterlistTabs defaultStart={sixDaysAgo()} defaultEnd={todayUs()} />
    </div>
  );
}
