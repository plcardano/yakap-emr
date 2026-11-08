import { describe, expect, it } from "vitest";
import { maskForLog, maskPin } from "./mask";

describe("maskForLog", () => {
  it("masks a PIN in the guide's format", () => {
    expect(maskPin("123456789012")).toBe("1234-*****-12");
  });

  it("removes secrets and masks identifiers at any depth", () => {
    expect(
      maskForLog({
        secret_key: "abc",
        request_id: "keep",
        enlistment: [{ patient_pin: "123456789012", patient_dob: "07/04/1990" }],
        member: { pin: "999988887777" },
        valid_id_image: "base64",
      }),
    ).toEqual({
      secret_key: "[REDACTED]",
      request_id: "keep",
      enlistment: [{ patient_pin: "1234-*****-12", patient_dob: "**/**/1990" }],
      member: { pin: "9999-*****-77" },
      valid_id_image: "[REDACTED]",
    });
  });
});
