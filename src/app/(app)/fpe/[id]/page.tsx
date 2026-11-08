import { notFound } from "next/navigation";
import { labelsFor, librariesFor, rulesFor } from "@/lib/pcapi-spec";
import { requireUser } from "@/server/auth/session";
import { draftEvidence, loadFpeDraft } from "@/server/fpe/service";
import { UploadWizard } from "@/components/spec-form/upload-wizard";

export const metadata = { title: "First Patient Encounter form" };

export default async function FpeDraftPage({ params }: PageProps<"/fpe/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const draft = await loadFpeDraft(user, id);
  if (!draft) notFound();

  return (
    <UploadWizard
      form="fpe"
      exitHref="/fpe"
      draftId={id}
      initialValues={draft.values}
      initialStep={draft.step}
      isCorrection={Boolean(draft.correctsSubmissionId)}
      evidence={await draftEvidence(user, draft.values)}
      rules={rulesFor("fpe")}
      labels={labelsFor("fpe")}
      libraries={librariesFor("fpe")}
    />
  );
}
