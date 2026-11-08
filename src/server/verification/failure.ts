import type { ActionFailure } from "@/lib/action-result";
import type { ValidationIssue } from "@/lib/pcapi-spec";
import {
  FALLBACK_COPY,
  FALLBACK_REASON,
  ISSUE_COPY,
  REASON_COPY,
} from "@/lib/pcapi-messages";
import {
  PcapiError,
  PcapiNetworkError,
  PcapiResponseError,
  PcapiValidationError,
} from "@/server/pcapi/errors";

export function fieldFailure(fieldErrors: Record<string, string>): ActionFailure {
  return { ok: false, title: "Some details need correcting", fieldErrors };
}

export function validationFailure(issues: ValidationIssue[]): ActionFailure {
  return fieldFailure(
    Object.fromEntries(
      issues.map(({ field, reason }) => [field, REASON_COPY[reason] ?? FALLBACK_REASON]),
    ),
  );
}

/** Turns a PCAPI failure into wording for staff. Other errors are not expected here. */
export function toFailure(error: unknown): ActionFailure {
  if (error instanceof PcapiValidationError) return validationFailure(error.issues);

  if (error instanceof PcapiError) {
    const copy = ISSUE_COPY[error.issues[0]?.issue] ?? FALLBACK_COPY;
    const isFieldList = error.hasIssue("validation_error");
    return {
      ok: false,
      ...copy,
      requestId: error.requestId,
      ...(isFieldList && {
        errors: error.issues.map(({ field }) => ({
          field,
          issue: "Check this value",
        })),
        fieldErrors: Object.fromEntries(
          error.issues.map(({ field }) => [field, FALLBACK_REASON]),
        ),
      }),
    };
  }

  if (error instanceof PcapiNetworkError) {
    return {
      ok: false,
      title: "PhilHealth could not be reached",
      body: "Check the connection and try again.",
    };
  }

  if (error instanceof PcapiResponseError) {
    return {
      ok: false,
      title: "The response from PhilHealth could not be read",
      body: "It was discarded. Contact PhilHealth support and quote the request ID.",
      requestId: error.requestId,
    };
  }

  throw error;
}

export function failureCode(error: unknown) {
  if (error instanceof PcapiError) return error.issues[0]?.issue ?? String(error.status);
  if (error instanceof PcapiValidationError) return "local_validation";
  if (error instanceof PcapiNetworkError) return "network";
  if (error instanceof PcapiResponseError) return error.issue;
  return "unknown";
}

export function requestIdOf(error: unknown) {
  return error instanceof PcapiError || error instanceof PcapiResponseError
    ? error.requestId
    : undefined;
}
