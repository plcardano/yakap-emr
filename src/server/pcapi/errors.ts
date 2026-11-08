import type { ValidationIssue } from "@/lib/pcapi-spec";

export type ApiIssue = { field: string; issue: string };

/** An error envelope from PCAPI. Program against status and issues, never the message. */
export class PcapiError extends Error {
  constructor(
    readonly status: number,
    readonly issues: ApiIssue[],
    readonly requestId: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = "PcapiError";
  }

  hasIssue(issue: string) {
    return this.issues.some((entry) => entry.issue === issue);
  }
}

/** The request failed the Data Dictionary checks and was not sent. */
export class PcapiValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super("The request failed validation and was not sent");
    this.name = "PcapiValidationError";
  }
}

/** PCAPI could not be reached, or did not return a usable response. */
export class PcapiNetworkError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PcapiNetworkError";
  }
}

/** A success response could not be decrypted or failed its hash check (guide Annex C). */
export class PcapiResponseError extends Error {
  constructor(
    readonly issue: string,
    readonly requestId: string | undefined,
  ) {
    super(`The response could not be read: ${issue}`);
    this.name = "PcapiResponseError";
  }
}
