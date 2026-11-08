import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptEnvelope, encryptEnvelope, EnvelopeError } from "./envelope";

// Guide Annex C, Test Vector.
const CIPHER_KEY = "PCAPI-TEST-CIPHER-KEY-0001";
const PLAIN = '{"patient_pin":"123456789012","selection_date":"10/24/2026"}';
const IV = Buffer.from("AAECAwQFBgcICQoLDA0ODw==", "base64");
const HASH = "c74558f2df0c6d3e26b22853bc46388d712689001f03d6f003b8f73d9f4a17f0";
const DOC = "8qipXLTaqv/erRM3acals23bNbNzdX5NeVpUWWYljJdsCUm3x1GfNvTheN/rR5AMpVVSYQmPVNLPcTp78aV84Q==";

describe("Annex C envelope", () => {
  it("matches the guide's test vector when encrypting", () => {
    expect(encryptEnvelope(PLAIN, CIPHER_KEY, { iv: IV })).toEqual({
      docMimeType: "application/json",
      hash: HASH,
      key1: "",
      key2: "",
      iv: "AAECAwQFBgcICQoLDA0ODw==",
      doc: DOC,
    });
  });

  it("matches the guide's test vector when decrypting", () => {
    const envelope = encryptEnvelope(PLAIN, CIPHER_KEY, { iv: IV });
    expect(decryptEnvelope(envelope, CIPHER_KEY).toString("utf8")).toBe(PLAIN);
  });

  it("adds no padding when the data is already a multiple of 16 bytes", () => {
    const plain = "0123456789abcdef";
    const envelope = encryptEnvelope(plain, CIPHER_KEY);
    expect(Buffer.from(envelope.doc, "base64")).toHaveLength(16);
    expect(decryptEnvelope(envelope, CIPHER_KEY).toString()).toBe(plain);
  });

  it("hashes UTF-8 bytes, so accented names round-trip", () => {
    const plain = '{"patient_lname":"PEÑA"}';
    const envelope = encryptEnvelope(plain, CIPHER_KEY);
    expect(decryptEnvelope(envelope, CIPHER_KEY).toString("utf8")).toBe(plain);
  });

  it("keeps PDF content as bytes", () => {
    const pdf = Buffer.concat([randomBytes(100), Buffer.from("\n%%EOF")]);
    const envelope = encryptEnvelope(pdf, CIPHER_KEY, { mimeType: "application/pdf" });
    expect(envelope.docMimeType).toBe("application/pdf");
    expect(decryptEnvelope(envelope, CIPHER_KEY).equals(pdf)).toBe(true);
  });

  it("uses a fresh IV for each call", () => {
    expect(encryptEnvelope(PLAIN, CIPHER_KEY).iv).not.toBe(encryptEnvelope(PLAIN, CIPHER_KEY).iv);
  });

  it("reports a changed hash as hash_mismatch", () => {
    const envelope = { ...encryptEnvelope(PLAIN, CIPHER_KEY), hash: "0".repeat(64) };
    expect(() => decryptEnvelope(envelope, CIPHER_KEY)).toThrowError(
      new EnvelopeError("hash_mismatch"),
    );
  });

  it("reports a malformed envelope as decryption_failed", () => {
    expect(() => decryptEnvelope({ doc: "x" }, CIPHER_KEY)).toThrowError(
      new EnvelopeError("decryption_failed"),
    );
    const bad = { ...encryptEnvelope(PLAIN, CIPHER_KEY), doc: "AAAA" };
    expect(() => decryptEnvelope(bad, CIPHER_KEY)).toThrowError(
      new EnvelopeError("decryption_failed"),
    );
  });
});
