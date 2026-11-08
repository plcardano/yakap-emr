import type { ApiFieldError } from "@/components/ui/error-summary";

export type ActionFailure = {
  ok: false;
  title: string;
  body?: string;
  /** Shown so staff can quote it to PhilHealth support. */
  requestId?: string;
  errors?: ApiFieldError[];
  /** Messages for this page's inputs, by field name. */
  fieldErrors?: Record<string, string>;
};

export type ActionResult<T> =
  | { ok: true; data: T; requestId?: string }
  | ActionFailure;
