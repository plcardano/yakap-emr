"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { StatusChip, type Tone } from "@/components/ui/status-chip";
import type { FpeListItem } from "@/server/fpe/service";
import { correctSubmissionAction } from "../uploads/actions";

const STATUS: Record<FpeListItem["status"], { tone: Tone; text: string }> = {
  draft: { tone: "neutral", text: "Draft" },
  queued: { tone: "warning", text: "Queued" },
  processing: { tone: "info", text: "Processing" },
  accepted: { tone: "success", text: "Accepted" },
  rejected: { tone: "danger", text: "Rejected" },
};

const REFRESH_MS = 3000;

export function FpeList({ items }: { items: FpeListItem[] }) {
  const router = useRouter();
  const waiting = items.some((item) => item.status === "queued" || item.status === "processing");

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  if (items.length === 0) return null;

  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <h2 className="mb-2 text-lg font-semibold text-navy">Drafts and submissions</h2>
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-navy">{item.patient}</p>
                {item.uploadNo && (
                  <p className="break-all text-xs text-muted">Upload no. {item.uploadNo}</p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <StatusChip {...STATUS[item.status]} />
                {item.status === "draft" && (
                  <ButtonLink variant="outline" href={`/fpe/${item.id}`}>
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
          </li>
        ))}
      </ul>
    </section>
  );
}
