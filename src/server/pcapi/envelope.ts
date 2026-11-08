import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Guide Annex C: AES-256-CBC, key = SHA-256 of the facility cipher key, null-byte padding.

export type EncryptedEnvelope = {
  docMimeType: string;
  hash: string;
  key1: string;
  key2: string;
  iv: string;
  doc: string;
};

export class EnvelopeError extends Error {
  constructor(readonly issue: "decryption_failed" | "hash_mismatch") {
    super(issue);
  }
}

function deriveKey(cipherKey: string) {
  return createHash("sha256").update(cipherKey, "utf8").digest();
}

function sha256Hex(data: Buffer) {
  return createHash("sha256").update(data).digest("hex");
}

function isEnvelope(value: unknown): value is EncryptedEnvelope {
  if (typeof value !== "object" || value === null) return false;
  const { docMimeType, hash, iv, doc } = value as Record<string, unknown>;
  return [docMimeType, hash, iv, doc].every((field) => typeof field === "string");
}

export function encryptEnvelope(
  plain: string | Buffer,
  cipherKey: string,
  options: { mimeType?: string; iv?: Buffer } = {},
): EncryptedEnvelope {
  const data = typeof plain === "string" ? Buffer.from(plain, "utf8") : plain;
  const iv = options.iv ?? randomBytes(16);
  const padding = (16 - (data.length % 16)) % 16;

  const cipher = createCipheriv("aes-256-cbc", deriveKey(cipherKey), iv);
  cipher.setAutoPadding(false);
  const doc = Buffer.concat([
    cipher.update(Buffer.concat([data, Buffer.alloc(padding)])),
    cipher.final(),
  ]);

  return {
    docMimeType: options.mimeType ?? "application/json",
    hash: sha256Hex(data),
    key1: "",
    key2: "",
    iv: iv.toString("base64"),
    doc: doc.toString("base64"),
  };
}

/** Returns the plain bytes, after checking them against the envelope's hash. */
export function decryptEnvelope(envelope: unknown, cipherKey: string): Buffer {
  if (!isEnvelope(envelope)) throw new EnvelopeError("decryption_failed");

  let plain: Buffer;
  try {
    const iv = Buffer.from(envelope.iv, "base64");
    const decipher = createDecipheriv("aes-256-cbc", deriveKey(cipherKey), iv);
    decipher.setAutoPadding(false);
    plain = Buffer.concat([
      decipher.update(Buffer.from(envelope.doc, "base64")),
      decipher.final(),
    ]);
  } catch {
    throw new EnvelopeError("decryption_failed");
  }

  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) end--;
  const data = plain.subarray(0, end);

  if (sha256Hex(data) !== envelope.hash) throw new EnvelopeError("hash_mismatch");
  return data;
}
