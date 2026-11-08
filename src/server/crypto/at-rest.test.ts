import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { decryptAtRest, encryptAtRest, hmacPin } from "./at-rest";

beforeAll(() => {
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.PIN_HMAC_KEY = randomBytes(32).toString("base64");
});

describe("encryption at rest", () => {
  it("round-trips UTF-8 text", () => {
    const stored = encryptAtRest('{"patient_lname":"PEÑA"}');
    expect(stored).not.toContain("PEÑA");
    expect(decryptAtRest(stored)).toBe('{"patient_lname":"PEÑA"}');
  });

  it("uses a new IV each time", () => {
    expect(encryptAtRest("same")).not.toBe(encryptAtRest("same"));
  });

  it("rejects tampered data", () => {
    const [version, iv, tag, data] = encryptAtRest("hello").split(".");
    const flipped = Buffer.from(data, "base64");
    flipped[0] ^= 1;
    expect(() =>
      decryptAtRest([version, iv, tag, flipped.toString("base64")].join(".")),
    ).toThrow();
  });

  it("gives a stable PIN lookup value", () => {
    expect(hmacPin("123456789012")).toBe(hmacPin("123456789012"));
    expect(hmacPin("123456789012")).not.toBe(hmacPin("123456789013"));
  });
});
