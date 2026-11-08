"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { StatusChip, type Tone } from "@/components/ui/status-chip";
import { TextField } from "@/components/ui/fields";
import { FORM_DEFINITIONS } from "@/lib/upload-forms/registry";
import type { UploadItem } from "@/server/uploads/service";
import { correctSubmissionAction } from "./actions";

export type MonitorItem = UploadItem;

const STATUS: Record<string, { tone: Tone; text: string }> = {
  queued: { tone: "warning", text: "Queued" },
  processing: { tone: "info", text: "Processing" },
  accepted: { tone: "success", text: "Accepted" },
  rejected: { tone: "danger", text: "Rejected" },
};

const FILTERS = ["all", "rejected", "queued", "processing", "accepted"] as const;
type Filter = (typeof FILTERS)[number];

const REFRESH_MS = 3000;

function formatTime(iso?: string) {
  return iso ? new Date(iso).toLocaleString("en-PH", { timeZone: "Asia/Manila" }) : "";
}

export function UploadMonitor({ items }: { items: MonitorItem[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const waiting = items.some((item) => item.status === "queued" || item.status === "processing");

  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => router.refresh(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [waiting, router]);

  const needle = search.trim().toLowerCase();
  const shown = items.filter(
    (item) =>
      (filter === "all" || item.status === filter) &&
      (!needle ||
        item.patient.toLowerCase().includes(needle) ||
        item.uploadNo?.toLowerCase().includes(needle)),
  );
  const count = (value: Filter) =>
    value === "all" ? items.length : items.filter((item) => item.status === value).length;

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-card p-5">
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={`rounded-md px-3 py-1.5 text-sm font-semibold capitalize ${
              filter === value ? "bg-primary-soft text-navy" : "text-muted hover:text-navy"
            }`}
          >
            {value} ({count(value)})
          </button>
        ))}
      </div>
      <div className="max-w-sm">
        <TextField
          label="Search by patient or upload number"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {shown.length === 0 ? (
        <p className="text-sm text-muted">No uploads to show.</p>
      ) : (
        <ul>
          {shown.map((item) => (
            <li key={item.id} className="flex flex-col gap-2 border-b border-line py-3 last:border-b-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-navy">
                    {FORM_DEFINITIONS[item.form].title} · {item.patient}
                  </p>
                  <p className="break-all text-xs text-muted">Upload no. {item.uploadNo}</p>
                  {item.processedAt && (
                    <p className="text-xs text-muted">Processed {formatTime(item.processedAt)}</p>
                  )}
                  {item.status === "rejected" && item.requestId && (
                    <p className="break-all text-xs text-muted">Request ID {item.requestId}</p>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <StatusChip {...STATUS[item.status]} />
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
                <div className="rounded-md bg-danger-soft p-3 text-sm">
                  <p className="font-semibold text-danger">Fields PhilHealth could not accept</p>
                  <ul className="mt-1 list-disc pl-5">
                    {item.errors?.map((error) => (
                      <li key={error.field}>{error.issue}</li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
