"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  open,
  title,
  onClose,
  footer,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-label={title}
      className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-xl bg-card p-0 backdrop:bg-black/50"
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-3">
        <h2 className="text-lg font-semibold text-navy">{title}</h2>
        <button type="button" aria-label="Close" onClick={onClose} className="text-xl text-muted">
          ×
        </button>
      </div>
      <div className="px-5 py-4 text-sm text-ink">{children}</div>
      {footer && (
        <div className="flex justify-end gap-3 border-t border-line px-5 py-3">{footer}</div>
      )}
    </dialog>
  );
}
