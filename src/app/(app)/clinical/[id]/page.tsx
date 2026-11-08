import { notFound } from "next/navigation";
import { UploadWizard } from "@/components/spec-form/upload-wizard";
import { labelsFor, librariesFor, rulesFor } from "@/lib/pcapi-spec";
import { requireUser } from "@/server/auth/session";
import { draftEvidence, loadDraft } from "@/server/uploads/service";

export const metadata = { title: "Clinical form" };

export default async function ClinicalDraftPage({ params }: PageProps<"/clinical/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const draft = await loadDraft(user, id);
  if (!draft || draft.form === "fpe") notFound();

  return (
    <UploadWizard
      form={draft.form}
      exitHref="/clinical"
      draftId={id}
      initialValues={draft.content.values}
      initialStep={draft.content.step}
      isCorrection={Boolean(draft.content.correctsSubmissionId)}
      evidence={await draftEvidence(user, draft.form, draft.content.values)}
      rules={rulesFor(draft.form)}
      labels={labelsFor(draft.form)}
      libraries={librariesFor(draft.form)}
    />
  );
}
