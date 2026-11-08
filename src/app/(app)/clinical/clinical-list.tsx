"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusChip, type Tone } from "@/components/ui/status-chip";
import { FORM_DEFINITIONS } from "@/lib/upload-forms/registry";
import type { UploadItem } from "@/server/uploads/service";
import { correctSubmissionAction, createChildAction } from "../uploads/actions";

const STATUS: Record<UploadItem["status"], { tone: Tone; text: string }> = {
  draft: { tone: "neutral", text: "Draft" },
  queued: { tone: "warning", text: "Queued" },
  processing: { tone: "info", text: "Processing" },
  accepted: { tone: "success", text: "Accepted" },
  rejected: { tone: "danger", text: "Rejected" },
};

const REFRESH_MS = 3000;

function Row({ item, nested }: { item: UploadItem; nested?: boolean }) {
  return (
    <div className={`flex flex-col gap-2 ${nested ? "ml-4 border-l-2 border-line pl-3" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold text-navy">
            {FORM_DEFINITIONS[item.form].title}
            {!nested && ` · ${item.patient}`}
          </p>
          {item.uploadNo && (
            <p className="break-all text-xs text-muted">Upload no. {item.uploadNo}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <StatusChip {...STATUS[item.status]} />
          {item.status === "draft" && (
            <ButtonLink variant="outline" href={`/clinical/${item.id}`}>
              Continue
            </ButtonLink>
          )}
          {item.status === "rejected" && (
            <form action={correctSubmissionAction.bind(null, item.id)}>
              <Button type="submit" variant="outline">
                Correct and resubmit
              </Button>
            </form>
          )}
          {item.status === "accepted" && item.form === "diagnostic_request" && (
            <form action={createChildAction.bind(null, item.id, "diagnostic_results")}>
              <Button type="submit" variant="outline">
                Enter results
              </Button>
            </form>
          )}
        </div>
      </div>
      {item.status === "rejected" && Boolean(item.errors?.length) && (
        <ul className="list-disc pl-5 text-sm text-danger">
          {item.errors?.map((error) => (
            <li key={error.field} className="break-all">
              {error.field}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Actions({ item }: { item: UploadItem }) {
  if (item.form !== "consultation" || item.status !== "accepted" || !item.flags) return null;
  const { diagnostics, medicine, referral } = item.flags;
  const action = (form: "diagnostic_request" | "medicine" | "referral") =>
    createChildAction.bind(null, item.id, form);

  return (
    <div className="flex flex-wrap gap-2">
      {diagnostics && (
        <form action={action("diagnostic_request")}>
          <Button type="submit" variant="secondary">
            Add Diagnostic Request
          </Button>
        </form>
      )}
      {medicine && (
        <form action={action("medicine")}>
          <Button type="submit" variant="secondary">
            Add Medicines
          </Button>
        </form>
      )}
      {referral && (
        <form action={action("referral")}>
          <Button type="submit" variant="secondary">
            Add Referral
          </Button>
        </form>
      )}
    </div>
  );
}

export function ClinicalList({ items }: { items: UploadItem[] }) {
  const router = useRouter();
  const waiting = items.some((item) => item.status === "queued" || item.status === "processing");

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  const roots = items.filter((item) => item.form === "consultation");
  const childrenOf = (id: string) => items.filter((item) => item.parentId === id);

  if (roots.length === 0) return null;

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-2 text-lg font-semibold text-navy">Consultations</h2>
      <ul>
        {roots.map((root) => (
          <li key={root.id} className="flex flex-col gap-3 border-b border-line py-3 last:border-b-0">
            <Row item={root} />
            <Actions item={root} />
            {childrenOf(root.id).map((child) => (
              <div key={child.id} className="flex flex-col gap-2">
                <Row item={child} nested />
                {childrenOf(child.id).map((grandchild) => (
                  <div key={grandchild.id} className="ml-4">
                    <Row item={grandchild} nested />
                  </div>
                ))}
              </div>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}
