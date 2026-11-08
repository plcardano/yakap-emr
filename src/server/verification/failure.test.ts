import { describe, expect, it } from "vitest";
import { ISSUE_COPY, pcuOutcome } from "@/lib/pcapi-messages";
import {
  PcapiError,
  PcapiNetworkError,
  PcapiResponseError,
  PcapiValidationError,
} from "@/server/pcapi/errors";
import { toFailure } from "./failure";

// Every issue code in the error tables of Implementation Guide rev20261026.
const GUIDE_ISSUES = [
  "assignment_not_found", "availment_not_found", "beneficiary_deceased", "beneficiary_not_found",
  "code_invalid", "code_not_found", "configuration_error", "consent_required", "decryption_failed",
  "empanelment_already_exists", "facility_not_found", "facility_not_linked", "gateway_timeout",
  "hash_mismatch", "internal_error", "invalid_credentials", "invalid_launch",
  "invalid_liveness_authorization", "invalid_request", "invalid_upstream_response",
  "multiple_matches", "no_accepted_fpe", "no_active_selection", "pcu_not_same_day",
  "pcu_not_verified", "pcu_pin_mismatch", "pcu_result_not_accepted", "pcu_transaction_not_found",
  "rate_limit_exceeded", "selected_other_facility", "selection_already_exists",
  "service_unavailable", "software_not_certified", "transaction_already_exists", "unauthorized",
  "upload_not_found", "upstream_error", "upstream_unavailable", "validation_error",
];

describe("staff messages", () => {
  it.each(GUIDE_ISSUES)("has wording for %s", (issue) => {
    expect(ISSUE_COPY[issue]?.title).toBeTruthy();
  });

  it("never uses the API's message text", () => {
    const failure = toFailure(
      new PcapiError(404, [{ field: "x", issue: "beneficiary_not_found" }], "req", "reworded by API"),
    );
    expect(JSON.stringify(failure)).not.toContain("reworded by API");
    expect(failure).toMatchObject({ title: "No beneficiary found", requestId: "req" });
  });

  it("gives a safe message for an unknown issue code", () => {
    expect(
      toFailure(new PcapiError(500, [{ field: "", issue: "brand_new_code" }], "req", "x")),
    ).toMatchObject({ title: "The request could not be completed", requestId: "req" });
  });

  it("lists fields for a validation error", () => {
    expect(
      toFailure(new PcapiError(400, [{ field: "soap.case_no", issue: "validation_error" }], "r", "x")),
    ).toMatchObject({ fieldErrors: { "soap.case_no": expect.any(String) } });
  });

  it("explains network and unreadable responses", () => {
    expect(toFailure(new PcapiNetworkError("down"))).toMatchObject({
      title: "PhilHealth could not be reached",
    });
    expect(toFailure(new PcapiResponseError("hash_mismatch", "req"))).toMatchObject({
      title: "The response from PhilHealth could not be read",
      requestId: "req",
    });
  });

  it("maps local validation to fields", () => {
    expect(
      toFailure(
        new PcapiValidationError([{ field: "patient_pin", issue: "validation_error", reason: "required" }]),
      ),
    ).toMatchObject({ fieldErrors: { patient_pin: "This field is required." } });
  });

  it("does not hide programming errors", () => {
    expect(() => toFailure(new TypeError("bug"))).toThrow("bug");
  });
});

describe("PhilHealth Check outcomes (guide Annex B)", () => {
  it.each(["105", "109"])("%s verifies", (code) => {
    expect(pcuOutcome(code).verified).toBe(true);
  });
  it.each(["100", "101", "102", "103", "104", "106", "107", "108", "999"])("%s does not", (code) => {
    expect(pcuOutcome(code).verified).toBe(false);
  });
});
