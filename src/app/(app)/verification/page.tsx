import { libraries } from "@/lib/pcapi-spec";
import { requireUser } from "@/server/auth/session";
import { manilaDate } from "@/server/pcapi/record-number-format";
import { VerificationTabs } from "./verification-tabs";

function todayUs() {
  const [year, month, day] = manilaDate().split("-");
  return `${month}/${day}/${year}`;
}

export const metadata = { title: "Patient verification" };

export default async function VerificationPage() {
  await requireUser();

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">Patient verification</h1>
        <p className="mt-1 text-muted">Confirm the patient&apos;s identity before you transact.</p>
      </header>
      <VerificationTabs
        today={todayUs()}
        validIdTypes={libraries["Valid ID Type"].map(({ code, description }) => ({
          value: code,
          label: description,
        }))}
      />
    </div>
  );
}
