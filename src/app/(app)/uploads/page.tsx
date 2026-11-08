import { labelsFor, type UploadForm } from "@/lib/pcapi-spec";
import { requireUser } from "@/server/auth/session";
import { listUploads } from "@/server/uploads/service";
import { UploadMonitor, type MonitorItem } from "./upload-monitor";

const FORMS: UploadForm[] = [
  "fpe",
  "consultation",
  "diagnostic_request",
  "diagnostic_results",
  "medicine",
  "referral",
];

function labelOf(form: UploadForm, field: string) {
  return labelsFor(form)[field.replace(/\[\d+\]/g, "[]")]?.label ?? field;
}

export default async function UploadsPage() {
  const user = await requireUser();
  const items = await listUploads(user, FORMS);
  const monitored = items
    .filter((item) => item.status !== "draft")
    .map(
      (item): MonitorItem => ({
        ...item,
        errors: item.errors?.map((error) => ({
          ...error,
          issue: labelOf(item.form, error.field),
        })),
      }),
    );

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h1 className="text-3xl font-bold text-navy">Upload status</h1>
        <p className="mt-1 text-muted">Every submission to PhilHealth and its current outcome.</p>
      </header>
      <UploadMonitor items={monitored} />
    </div>
  );
}
