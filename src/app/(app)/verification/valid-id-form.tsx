"use client";

import { useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ErrorSummary } from "@/components/ui/error-summary";
import { ConsentField, SelectField, TextField } from "@/components/ui/fields";
import type { ActionFailure } from "@/lib/action-result";
import { captureValidIdAction } from "./actions";

const MAX_BYTES = 2 * 1024 * 1024;
const MIN_QUALITY = 0.4;

function toJpeg(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

/** The guide wants a JPEG resized to at most 2 MB before encoding (3.10). */
async function shrinkJpeg(file: File): Promise<Blob | null> {
  if (file.size <= MAX_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  let scale = Math.min(1, Math.sqrt(MAX_BYTES / file.size));
  let quality = 0.85;

  for (;;) {
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await toJpeg(canvas, quality);
    if (blob && blob.size <= MAX_BYTES) return blob;
    if (quality <= MIN_QUALITY) return null;
    quality -= 0.15;
    scale *= 0.85;
  }
}

export function ValidIdForm({ types }: { types: { value: string; label: string }[] }) {
  const [pin, setPin] = useState("");
  const [type, setType] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [failure, setFailure] = useState<ActionFailure | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setFailure(null);
    setSaved(false);
    startTransition(async () => {
      if (!file) {
        setFailure({
          ok: false,
          title: "Some details need correcting",
          fieldErrors: { valid_id_image: "Upload a JPEG image of the ID." },
        });
        return;
      }
      const image = await shrinkJpeg(file).catch(() => null);
      if (!image) {
        setFailure({
          ok: false,
          title: "Some details need correcting",
          fieldErrors: { valid_id_image: "This image could not be reduced to 2 MB." },
        });
        return;
      }

      const form = new FormData();
      form.set("patient_pin", pin);
      form.set("valid_id_type", type);
      form.set("consent", String(consent));
      form.set("image", image, "valid-id.jpg");

      const outcome = await captureValidIdAction(form);
      if (!outcome.ok) return setFailure(outcome);
      setSaved(true);
      setFile(null);
      if (fileInput.current) fileInput.current.value = "";
    });
  }

  const errors = failure?.fieldErrors;

  return (
    <form onSubmit={submit} noValidate className="flex max-w-xl flex-col gap-4">
      {failure && !errors && (
        <ErrorSummary title={failure.title} body={failure.body} requestId={failure.requestId} />
      )}
      {saved && (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          The ID was saved. It will be sent with today&apos;s Selection, FPE or Empanelment for
          this patient.
        </p>
      )}
      <p className="text-sm text-muted">Only listed ID types are accepted.</p>
      <TextField
        label="PIN"
        required
        name="patient_pin"
        placeholder="12 digits, no dashes"
        inputMode="numeric"
        maxLength={12}
        value={pin}
        onChange={(event) => setPin(event.target.value)}
        error={errors?.patient_pin}
      />
      <SelectField
        label="ID type"
        required
        name="valid_id_type"
        options={types}
        value={type}
        onChange={(event) => setType(event.target.value)}
        error={errors?.valid_id_type}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="valid-id-image" className="text-sm font-semibold text-ink">
          Picture of the ID <span className="text-danger">*</span>
        </label>
        <input
          ref={fileInput}
          id="valid-id-image"
          type="file"
          accept="image/jpeg"
          className="text-sm"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted">JPEG only. Larger pictures are reduced to 2 MB.</p>
        {errors?.valid_id_image && (
          <p className="text-xs text-danger">{errors.valid_id_image}</p>
        )}
      </div>
      <ConsentField checked={consent} onChange={setConsent} error={errors?.consent} />
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save ID"}
        </Button>
      </div>
    </form>
  );
}
